"""Path checks of the diarization service: python3 -m unittest -q test_server (in docker/diarize)."""
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path

import server

MEETING = "123e46e5-b342-4df1-b234-18f0e35c6d57"


class ResolveTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        folder = self.root / "teams" / "1" / MEETING
        folder.mkdir(parents=True)
        (folder / "audio.wav").write_bytes(b"RIFF")
        (folder / "notes.txt").write_text("x")

    def status(self, file):
        try:
            server.resolve(file, self.root)
        except server.BadRequest as exc:
            return exc.status
        return 200

    def test_only_meeting_recordings_can_be_named(self):
        self.assertEqual(self.status(f"teams/1/{MEETING}/audio.wav"), 200)
        for bad in ("../../etc/passwd", "teams/1/x/notes.txt", f"teams/1/{MEETING}/notes.txt",
                    f"teams/1/{MEETING}/../{MEETING}/audio.wav", f"/teams/1/{MEETING}/audio.wav", None, 5):
            self.assertEqual(self.status(bad), 400, bad)

    def test_missing_recording_is_404(self):
        self.assertEqual(self.status("teams/2/00000000-0000-0000-0000-000000000000/audio.wav"), 404)

    def test_language_is_passed_only_when_supported(self):
        path = Path("/output/x.wav")
        self.assertIn("-l", server.command(path, "zh"))
        self.assertNotIn("-l", server.command(path, "ja"))
        self.assertEqual(server.command(path, "en")[-3:], ["-l", "en", str(path)])


class RunJobTest(unittest.TestCase):
    def test_a_newer_request_for_the_same_recording_stops_the_earlier_run(self):
        folder = Path(tempfile.mkdtemp())
        cli = folder / "fake-cli"
        # Like transcribe-cli, the long run is the child process itself (exec), so stopping it ends it at once.
        cli.write_text("#!/bin/sh\n[ \"${SLEEP:-0}\" = 0 ] || exec sleep \"$SLEEP\"\necho \"[ 0.00 -> 1.00] S1: hi\"\n")
        cli.chmod(0o755)
        server.CLI = str(cli)
        path = folder / "audio.wav"
        results = []
        os.environ["SLEEP"] = "30"
        first = threading.Thread(target=lambda: results.append(server.run_job(path, "zh")))
        first.start()
        time.sleep(0.5)
        os.environ["SLEEP"] = "0"
        started = time.monotonic()
        code, out, _, seconds = server.run_job(path, "zh")
        self.assertLess(time.monotonic() - started, 5)   # did not wait for the 30 s run
        first.join(5)
        self.assertFalse(first.is_alive())
        self.assertNotEqual(results[0][0], 0)          # the earlier run was stopped
        self.assertEqual((code, out.strip()), (0, "[ 0.00 -> 1.00] S1: hi"))
        self.assertEqual(server.running, {})


if __name__ == "__main__":
    unittest.main()

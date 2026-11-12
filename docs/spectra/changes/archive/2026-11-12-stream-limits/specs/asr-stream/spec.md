## ADDED Requirements

### Requirement: Bounded receive queue

The ASR service SHALL hold at most `ASR_RECV_QUEUE_MAX` (default 500) received messages per connection that recognition has not processed yet. When the queue is full, the service SHALL stop reading from that connection until recognition takes a message out, so a client sending faster than recognition is slowed down by the connection itself; no received audio SHALL be dropped.

#### Scenario: A client sends faster than recognition

- **WHEN** a client sends audio much faster than real time
- **THEN** the number of unprocessed messages held for its connection never exceeds 500, and every chunk sent is still recognized in order

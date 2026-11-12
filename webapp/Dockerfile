FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# The whole app (modules, migrations, static files): the image runs on its own; compose mounts ./webapp over it for
# development (app-image-reproducible).
COPY . .
EXPOSE 8080
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]

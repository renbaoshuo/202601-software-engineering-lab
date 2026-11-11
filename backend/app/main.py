from fastapi import FastAPI

app = FastAPI(title="QueryPilot API")


@app.get("/api/hello")
def hello():
    return {"message": "Hello from FastAPI"}


@app.get("/api/health")
def health():
    return {"status": "ok"}

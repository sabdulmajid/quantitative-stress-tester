from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.services.gbm import prewarm_gbm_engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    prewarm_gbm_engine()
    yield


app = FastAPI(title="Quant Stress Engine", version="0.1.0", lifespan=lifespan)
app.include_router(router)

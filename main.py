from contextlib import asynccontextmanager
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

ml_model = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The .pkl file holds a dict: {"model": ..., "threshold": ..., "features": [...]}
    artifact = joblib.load(BASE_DIR / "credit_risk_model.pkl")
    ml_model["model"] = artifact["model"]
    ml_model["threshold"] = artifact["threshold"]
    ml_model["features"] = artifact["features"]

    yield

    ml_model.clear()


app = FastAPI(title="Credit Risk Predictor", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve style.css, script.js, etc. from /static
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class LoanApplication(BaseModel):
    person_age: int
    person_income: float
    person_home_ownership: str
    person_emp_length: float
    loan_intent: str
    loan_grade: str
    loan_amnt: float
    loan_int_rate: float
    loan_percent_income: float
    cb_person_default_on_file: str
    cb_person_cred_hist_length: int


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": "model" in ml_model}



@app.post("/predict")
def predict(data: LoanApplication):
    # One-row DataFrame with columns in the same order the model was trained on
    input_df = pd.DataFrame([data.model_dump()])[ml_model["features"]]

    probability = float(ml_model["model"].predict_proba(input_df)[:, 1][0])
    threshold = ml_model["threshold"]
    prediction = probability >= threshold

    return {
        "default_probability": round(probability, 4),
        "default_prediction": int(prediction),
        "threshold": round(threshold, 4),
        "result": "High Risk" if prediction else "Low Risk",
    }

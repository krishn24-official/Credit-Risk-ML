from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import joblib
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

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
    # Reject unknown keys, including a client-supplied loan_percent_income.
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "person_age": 27,
                    "person_income": 45000,
                    "person_home_ownership": "RENT",
                    "person_emp_length": 3,
                    "loan_intent": "MEDICAL",
                    "loan_grade": "C",
                    "loan_amnt": 12000,
                    "loan_int_rate": 13.5,
                    "cb_person_default_on_file": "N",
                    "cb_person_cred_hist_length": 4,
                }
            ]
        },
    )

    person_age: int = Field(ge=18, le=100)
    person_income: float = Field(gt=0, le=10_000_000, allow_inf_nan=False)
    # Categories must match the training data exactly: the model's OneHotEncoder
    # uses handle_unknown="ignore", so a typo would silently produce a wrong score.
    person_home_ownership: Literal["RENT", "MORTGAGE", "OWN", "OTHER"]
    person_emp_length: float = Field(ge=0, le=60, allow_inf_nan=False)
    loan_intent: Literal[
        "PERSONAL", "EDUCATION", "MEDICAL", "VENTURE", "HOMEIMPROVEMENT", "DEBTCONSOLIDATION"
    ]
    loan_grade: Literal["A", "B", "C", "D", "E", "F", "G"]
    loan_amnt: float = Field(gt=0, le=35_000, allow_inf_nan=False)
    loan_int_rate: float = Field(gt=0, le=40, allow_inf_nan=False)
    cb_person_default_on_file: Literal["Y", "N"]
    cb_person_cred_hist_length: int = Field(ge=0, le=60)

    @model_validator(mode="after")
    def check_emp_length_vs_age(self):
        if self.person_emp_length > self.person_age - 14:
            raise ValueError("person_emp_length is too long for person_age")
        return self

    @model_validator(mode="after")
    def check_loan_vs_income(self):
        # The largest loan-to-income ratio in the training data is 0.83. Ratios above 1
        # are far outside what the model has seen, and it returns a probability of 1.0.
        if self.loan_amnt > self.person_income:
            raise ValueError("loan_amnt cannot be more than person_income")
        return self

    # Derived on the server, the same way the training data defines it
    # (loan_amnt / person_income, rounded to 2 decimals), so clients cannot
    # send a value that disagrees with the loan amount and income.
    @computed_field
    @property
    def loan_percent_income(self) -> float:
        return round(self.loan_amnt / self.person_income, 2)


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

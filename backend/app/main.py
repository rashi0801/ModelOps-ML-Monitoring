from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from scipy.stats import ks_2samp, chi2_contingency
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
ARTIFACT_DIR = BASE_DIR / "artifacts"
DB_PATH = BASE_DIR / "modelops.db"
REFERENCE_PATH = DATA_DIR / "reference.csv"
MODEL_PATH = ARTIFACT_DIR / "churn_model.joblib"
FEATURES = ["tenure_months", "monthly_charges", "support_tickets", "usage_hours", "late_payments"]
TARGET = "churn"

app = FastAPI(title="ModelOps API", version="1.0.0", description="ML model monitoring and observability MVP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def create_database() -> None:
    with get_conn() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            model_type TEXT NOT NULL,
            created_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Active'
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            rows_scanned INTEGER NOT NULL,
            drifted_features INTEGER NOT NULL,
            drift_share REAL NOT NULL,
            accuracy REAL,
            precision REAL,
            recall REAL,
            f1 REAL,
            status TEXT NOT NULL,
            results_json TEXT NOT NULL,
            FOREIGN KEY(model_id) REFERENCES models(id)
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            feature TEXT NOT NULL,
            severity TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            acknowledged INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(run_id) REFERENCES runs(id)
        )""")
        existing = conn.execute("SELECT id FROM models WHERE id = 1").fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO models (id, name, version, model_type, created_at, status) VALUES (1, ?, ?, ?, ?, ?)",
                ("Customer Churn Classifier", "v1.0.0", "Random Forest", utc_now(), "Active"),
            )


def generate_demo_data() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    if REFERENCE_PATH.exists() and MODEL_PATH.exists():
        return
    rng = np.random.default_rng(42)
    n = 1800
    tenure = rng.integers(1, 73, n)
    charges = np.clip(rng.normal(72, 22, n), 18, 130)
    tickets = np.clip(rng.poisson(1.6, n), 0, 10)
    usage = np.clip(rng.normal(32, 11, n), 1, 70)
    late = np.clip(rng.poisson(0.8, n), 0, 6)
    logit = -1.0 - 0.035 * tenure + 0.025 * (charges - 65) + 0.38 * tickets - 0.025 * usage + 0.45 * late
    probability = 1 / (1 + np.exp(-logit))
    churn = rng.binomial(1, probability)
    df = pd.DataFrame({
        "tenure_months": tenure,
        "monthly_charges": np.round(charges, 2),
        "support_tickets": tickets,
        "usage_hours": np.round(usage, 2),
        "late_payments": late,
        "churn": churn,
    })
    df.to_csv(REFERENCE_PATH, index=False)
    X_train, X_test, y_train, _ = train_test_split(df[FEATURES], df[TARGET], test_size=0.2, random_state=42, stratify=df[TARGET])
    model = RandomForestClassifier(n_estimators=140, max_depth=9, min_samples_leaf=3, random_state=42, class_weight="balanced")
    model.fit(X_train, y_train)
    joblib.dump(model, MODEL_PATH)


def psi(expected: np.ndarray, actual: np.ndarray, bins: int = 10) -> float:
    expected = np.asarray(expected, dtype=float)
    actual = np.asarray(actual, dtype=float)
    if len(expected) == 0 or len(actual) == 0:
        return 0.0
    edges = np.unique(np.quantile(expected, np.linspace(0, 1, bins + 1)))
    if len(edges) < 3:
        return 0.0
    edges[0], edges[-1] = -np.inf, np.inf
    e = np.histogram(expected, bins=edges)[0] / len(expected)
    a = np.histogram(actual, bins=edges)[0] / len(actual)
    e = np.clip(e, 1e-6, None)
    a = np.clip(a, 1e-6, None)
    return float(np.sum((a - e) * np.log(a / e)))


def feature_drift(reference: pd.Series, current: pd.Series, feature: str) -> dict[str, Any]:
    ref = pd.to_numeric(reference, errors="coerce").dropna().to_numpy(dtype=float)
    cur = pd.to_numeric(current, errors="coerce").dropna().to_numpy(dtype=float)
    if len(ref) < 2 or len(cur) < 2:
        return {"feature": feature, "test": "KS test", "statistic": 0.0, "p_value": 1.0, "psi": 0.0, "drifted": False, "severity": "Low", "reference_mean": float(np.mean(ref)) if len(ref) else 0, "current_mean": float(np.mean(cur)) if len(cur) else 0}
    ks = ks_2samp(ref, cur)
    feature_psi = psi(ref, cur)
    drifted = bool(ks.pvalue < 0.05 or feature_psi >= 0.20)
    severity = "High" if feature_psi >= 0.25 or ks.pvalue < 0.001 else ("Medium" if drifted else "Low")
    return {
        "feature": feature,
        "test": "KS test + PSI",
        "statistic": round(float(ks.statistic), 4),
        "p_value": round(float(ks.pvalue), 6),
        "psi": round(feature_psi, 4),
        "drifted": drifted,
        "severity": severity,
        "reference_mean": round(float(np.mean(ref)), 3),
        "current_mean": round(float(np.mean(cur)), 3),
        "reference_std": round(float(np.std(ref)), 3),
        "current_std": round(float(np.std(cur)), 3),
    }


@app.on_event("startup")
def startup() -> None:
    generate_demo_data()
    create_database()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "modelops-api"}


@app.get("/api/models")
def list_models() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM models ORDER BY id").fetchall()
    return [dict(row) for row in rows]


@app.get("/api/demo-csv/{kind}")
def demo_csv(kind: str):
    if kind not in {"stable", "shifted"}:
        raise HTTPException(404, "Demo dataset not found")
    path = DATA_DIR / ("production_stable.csv" if kind == "stable" else "production_shifted.csv")
    if not path.exists():
        from app.create_demo import main as create_demo
        create_demo()
    return FileResponse(path, media_type="text/csv", filename=path.name)


@app.get("/api/demo-data")
def demo_data() -> dict[str, str]:
    return {"reference": str(REFERENCE_PATH.name), "shifted": "production_shifted.csv", "target": TARGET, "features": FEATURES}


@app.get("/api/dashboard")
def dashboard() -> dict[str, Any]:
    with get_conn() as conn:
        total_runs = conn.execute("SELECT COUNT(*) AS n FROM runs").fetchone()["n"]
        open_alerts = conn.execute("SELECT COUNT(*) AS n FROM alerts WHERE acknowledged = 0").fetchone()["n"]
        latest = conn.execute("SELECT * FROM runs ORDER BY id DESC LIMIT 1").fetchone()
        recent = conn.execute("SELECT id, created_at, rows_scanned, drifted_features, drift_share, accuracy, f1, status FROM runs ORDER BY id DESC LIMIT 8").fetchall()
    latest_dict = dict(latest) if latest else None
    if latest_dict:
        latest_dict.pop("results_json", None)
    return {
        "total_runs": total_runs,
        "open_alerts": open_alerts,
        "latest_run": latest_dict,
        "recent_runs": [dict(r) for r in recent],
        "model": {"name": "Customer Churn Classifier", "version": "v1.0.0", "type": "Random Forest", "status": "Active"},
    }


@app.get("/api/runs")
def list_runs() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT id, model_id, created_at, rows_scanned, drifted_features, drift_share, accuracy, precision, recall, f1, status FROM runs ORDER BY id DESC LIMIT 100").fetchall()
    return [dict(row) for row in rows]


@app.get("/api/runs/{run_id}")
def get_run(run_id: int) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Monitoring run not found")
    result = dict(row)
    result["results"] = json.loads(result.pop("results_json"))
    return result


@app.post("/api/monitor")
async def monitor(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Upload a CSV file")
    try:
        raw = await file.read()
        if len(raw) > 15 * 1024 * 1024:
            raise HTTPException(413, "CSV must be smaller than 15 MB")
        from io import BytesIO
        current = pd.read_csv(BytesIO(raw))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"Could not read CSV: {exc}")
    missing = [column for column in FEATURES if column not in current.columns]
    if missing:
        raise HTTPException(400, f"Missing required feature columns: {', '.join(missing)}")
    if current.empty:
        raise HTTPException(400, "CSV has no data rows")
    if len(current) > 100_000:
        raise HTTPException(400, "MVP limit is 100,000 rows per upload")
    for column in FEATURES:
        current[column] = pd.to_numeric(current[column], errors="coerce")
    invalid = current[FEATURES].isna().sum()
    if invalid.sum() > 0:
        details = {key: int(value) for key, value in invalid.items() if value > 0}
        raise HTTPException(400, f"Missing or non-numeric values in required features: {details}")
    reference = pd.read_csv(REFERENCE_PATH)
    drift_results = [feature_drift(reference[f], current[f], f) for f in FEATURES]
    drifted = [item for item in drift_results if item["drifted"]]
    drift_share = len(drifted) / len(FEATURES)
    model = joblib.load(MODEL_PATH)
    predictions = model.predict(current[FEATURES])
    metrics: dict[str, float] = {}
    if TARGET in current.columns:
        labels = pd.to_numeric(current[TARGET], errors="coerce")
        if labels.isna().any() or not set(labels.unique()).issubset({0, 1}):
            raise HTTPException(400, "If supplied, churn labels must contain only 0 or 1")
        y = labels.astype(int).to_numpy()
        metrics = {
            "accuracy": round(float(accuracy_score(y, predictions)), 4),
            "precision": round(float(precision_score(y, predictions, zero_division=0)), 4),
            "recall": round(float(recall_score(y, predictions, zero_division=0)), 4),
            "f1": round(float(f1_score(y, predictions, zero_division=0)), 4),
        }
    results = {
        "features": drift_results,
        "prediction_distribution": [{"label": "No churn", "count": int((predictions == 0).sum())}, {"label": "Churn", "count": int((predictions == 1).sum())}],
        "metrics_available": bool(metrics),
        "metrics_note": "Metrics compare predictions against supplied ground-truth labels." if metrics else "No ground-truth churn column was supplied; predictive performance cannot be evaluated for this run.",
        "metrics": metrics,
    }
    status = "Critical" if any(item["severity"] == "High" for item in drifted) else ("Warning" if drifted else "Healthy")
    created_at = utc_now()
    with get_conn() as conn:
        cursor = conn.execute(
            "INSERT INTO runs (model_id, created_at, rows_scanned, drifted_features, drift_share, accuracy, precision, recall, f1, status, results_json) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (created_at, len(current), len(drifted), round(drift_share, 4), metrics.get("accuracy"), metrics.get("precision"), metrics.get("recall"), metrics.get("f1"), status, json.dumps(results)),
        )
        run_id = int(cursor.lastrowid)
        for item in drifted:
            conn.execute(
                "INSERT INTO alerts (run_id, feature, severity, message, created_at) VALUES (?, ?, ?, ?, ?)",
                (run_id, item["feature"], item["severity"], f"Distribution shift detected for {item['feature']} (PSI {item['psi']}, p-value {item['p_value']}).", created_at),
            )
    return {"run_id": run_id, "created_at": created_at, "rows_scanned": len(current), "drifted_features": len(drifted), "drift_share": round(drift_share, 4), "status": status, "results": results}


@app.get("/api/alerts")
def list_alerts() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("""SELECT alerts.*, runs.status AS run_status FROM alerts
            JOIN runs ON runs.id = alerts.run_id ORDER BY alerts.id DESC LIMIT 100""").fetchall()
    return [dict(row) for row in rows]


class AcknowledgeBody(BaseModel):
    acknowledged: bool = True


@app.patch("/api/alerts/{alert_id}")
def acknowledge_alert(alert_id: int, body: AcknowledgeBody) -> dict[str, Any]:
    with get_conn() as conn:
        cursor = conn.execute("UPDATE alerts SET acknowledged = ? WHERE id = ?", (int(body.acknowledged), alert_id))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Alert not found")
        row = conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
    return dict(row)

# ModelOps — ML Model Monitoring & Observability Platform

A two-day full-stack MVP using React + TypeScript + Vite + Recharts, FastAPI, SQLite, Pandas, SciPy, and Scikit-learn.

## Features
- Dark SaaS-style React dashboard
- Synthetic customer churn dataset and trained Random Forest classifier
- Reference vs. production feature drift analysis using KS tests and PSI
- Model prediction distribution and optional accuracy/precision/recall/F1 when labels are included
- Persisted model registry, monitoring run history, and alert acknowledgement
- Stable and deliberately shifted demo CSV batches
- FastAPI interactive docs at `/docs`

## Requirements
- Python 3.11 recommended
- Node.js 20 LTS recommended
- npm

## Run the backend
Open terminal 1:

```bash
cd backend
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m app.create_demo
uvicorn app.main:app --reload
```

Backend runs at `http://127.0.0.1:8000`; docs at `http://127.0.0.1:8000/docs`.

On first startup the API creates `data/reference.csv`, trains `artifacts/churn_model.joblib`, and creates `modelops.db`. `python -m app.create_demo` creates `data/production_stable.csv` and `data/production_shifted.csv`.

## Run the frontend
Open terminal 2 from the project root:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Demo walkthrough
1. Open ModelOps and wait for the dashboard to load.
2. Click **Run monitoring**.
3. Choose **Stable batch**; inspect the run details.
4. Run monitoring again and choose **Shifted batch**.
5. Open **Alerts** to acknowledge detected drift alerts.
6. Open **Monitoring runs** to compare history.

## CSV format
Required feature columns (numeric):

- `tenure_months`
- `monthly_charges`
- `support_tickets`
- `usage_hours`
- `late_payments`

Optional target: `churn`, containing only 0/1. Without this column, ModelOps reports prediction distribution and drift but does not claim to know live model accuracy.

## Drift logic
- Numeric feature drift is flagged when the two-sample Kolmogorov–Smirnov p-value is below 0.05 **or** PSI is at least 0.20.
- PSI around 0.20 is a heuristic signal, not a universal threshold. Validate thresholds for the real use case and sample size.
- A drift alert means the input distribution changed; it does not prove that model accuracy declined.

## Project structure
```text
modelops/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   └── create_demo.py
│   ├── data/                 # generated CSVs
│   ├── artifacts/            # generated model artifact
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── lib/api.ts
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── styles.css
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

## MVP limitations and next steps
- The initial model is a synthetic-data demo, not a validated production churn model.
- Model registration is seeded with one demo model; user-managed model uploads and versioning are future work.
- Monitoring runs are synchronous and intended for small CSV batches. A background task queue is not included in this two-day MVP.
- Authentication, multi-tenancy, deployment, and automated scheduled monitoring are intentionally out of scope.

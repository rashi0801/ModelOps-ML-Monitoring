# ModelOps Backend

## Setup (Python 3.11 recommended)

```bash
cd backend
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
python -m app.create_demo
uvicorn app.main:app --reload
```

API docs: http://127.0.0.1:8000/docs

On first startup, the API creates a synthetic reference dataset, trains a Random Forest classifier, and initializes SQLite. Run `python -m app.create_demo` to generate reproducible stable and shifted production CSVs.

Required CSV columns: `tenure_months`, `monthly_charges`, `support_tickets`, `usage_hours`, `late_payments`. Optional target column: `churn` (0 or 1). Metrics are only reported when ground-truth labels are supplied.

"""Generate a shifted demo batch for demonstrating drift detection."""
from pathlib import Path
import numpy as np
import pandas as pd

BASE = Path(__file__).resolve().parents[1]
DATA = BASE / "data"
FEATURES = ["tenure_months", "monthly_charges", "support_tickets", "usage_hours", "late_payments"]


def main() -> None:
    reference = pd.read_csv(DATA / "reference.csv")
    rng = np.random.default_rng(123)
    n = 350
    shifted = pd.DataFrame({
        "tenure_months": np.clip(rng.normal(18, 12, n).round().astype(int), 1, 72),
        "monthly_charges": np.clip(rng.normal(92, 16, n), 18, 130).round(2),
        "support_tickets": np.clip(rng.poisson(3.3, n), 0, 10),
        "usage_hours": np.clip(rng.normal(25, 12, n), 1, 70).round(2),
        "late_payments": np.clip(rng.poisson(1.8, n), 0, 6),
    })
    # Include labels generated from the same illustrative process so the demo can show metrics too.
    logit = -1.0 - 0.035 * shifted["tenure_months"] + 0.025 * (shifted["monthly_charges"] - 65) + 0.38 * shifted["support_tickets"] - 0.025 * shifted["usage_hours"] + 0.45 * shifted["late_payments"]
    p = 1 / (1 + np.exp(-logit))
    shifted["churn"] = rng.binomial(1, p)
    shifted.to_csv(DATA / "production_shifted.csv", index=False)
    reference.sample(n=min(350, len(reference)), random_state=7).to_csv(DATA / "production_stable.csv", index=False)
    print(f"Created {DATA / 'production_shifted.csv'} and production_stable.csv")


if __name__ == "__main__":
    main()

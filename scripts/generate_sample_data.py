#!/usr/bin/env python3
"""
Generate a synthetic Treasury vendor-payment dataset for the anomaly-detection POC.

This produces realistic-looking disbursement records for a set of recurring
vendors, plus a small number of deliberately seeded anomalies (duplicates,
statistical outliers, off-hours timing, brand-new vendors, and amounts just
under a reporting threshold). The seeded rows are tagged internally (see
`_seeded_anomaly` below) purely so this script can print a summary of what
it planted -- that column is dropped from the CSV the app actually reads,
so the detector has to find them blind, the same way it would on real data.

Usage:
    python3 scripts/generate_sample_data.py [--rows 600] [--seed 42] [--out data/sample_transactions.csv]
"""
import argparse
import csv
import random
from datetime import datetime, timedelta

DEPARTMENTS = [
    "Bureau of the Fiscal Service",
    "Office of Financial Stability",
    "Community Development Financial Institutions Fund",
    "Alcohol and Tobacco Tax and Trade Bureau",
    "Financial Crimes Enforcement Network",
]

PAYMENT_TYPES = ["ACH", "Wire", "Check"]

VENDORS = [
    ("V1001", "Meridian Facilities Group", 4200, 9500),
    ("V1002", "Capitol IT Services LLC", 8000, 22000),
    ("V1003", "BlueRiver Consulting", 15000, 60000),
    ("V1004", "National Office Supply Co", 300, 2200),
    ("V1005", "Sterling Security Solutions", 6000, 14000),
    ("V1006", "Apex Data Systems", 10000, 45000),
    ("V1007", "Harbor Logistics Inc", 1200, 5000),
    ("V1008", "Federal Print & Mail", 500, 3000),
    ("V1009", "Cornerstone Legal Advisors", 9000, 30000),
    ("V1010", "Pioneer Facilities Maintenance", 2000, 7000),
]

ONE_OFF_VENDOR_NAMES = [
    "Kestrel Advisory Partners",
    "Northgate Rapid Solutions LLC",
    "Ironwood Program Services",
]


def rand_amount(lo, hi):
    return round(random.uniform(lo, hi), 2)


def business_datetime(start, end):
    """Return a random weekday timestamp between 07:00 and 19:00 (normal business hours)."""
    d = start + timedelta(days=random.randint(0, (end - start).days))
    while d.weekday() >= 5:  # skip weekends for the "normal" baseline
        d = start + timedelta(days=random.randint(0, (end - start).days))
    hour = random.randint(7, 18)
    minute = random.randint(0, 59)
    return d.replace(hour=hour, minute=minute, second=0, microsecond=0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", type=int, default=600, help="approx. number of baseline rows")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="data/sample_transactions.csv")
    args = ap.parse_args()

    random.seed(args.seed)
    start = datetime(2026, 5, 1)
    end = datetime(2026, 8, 1)

    rows = []
    txn_counter = 1

    def new_id():
        nonlocal txn_counter
        tid = f"TXN{txn_counter:06d}"
        txn_counter += 1
        return tid

    # --- Baseline "normal" traffic across recurring vendors ---
    for _ in range(args.rows):
        vid, vname, lo, hi = random.choice(VENDORS)
        dt = business_datetime(start, end)
        rows.append({
            "transaction_id": new_id(),
            "date": dt.strftime("%Y-%m-%d"),
            "time": dt.strftime("%H:%M"),
            "vendor_id": vid,
            "vendor_name": vname,
            "department": random.choice(DEPARTMENTS),
            "payment_type": random.choice(PAYMENT_TYPES),
            "amount": rand_amount(lo, hi),
            "description": "Recurring services / goods disbursement",
            "_seeded_anomaly": "",
        })

    # --- Seeded anomaly 1: exact duplicate payments (same vendor, amount, ~1-2 days apart) ---
    for _ in range(6):
        vid, vname, lo, hi = random.choice(VENDORS)
        base_dt = business_datetime(start, end)
        amt = rand_amount(lo, hi)
        for offset in (0, random.choice([1, 2])):
            dt = base_dt + timedelta(days=offset)
            rows.append({
                "transaction_id": new_id(),
                "date": dt.strftime("%Y-%m-%d"),
                "time": dt.strftime("%H:%M"),
                "vendor_id": vid,
                "vendor_name": vname,
                "department": random.choice(DEPARTMENTS),
                "payment_type": random.choice(PAYMENT_TYPES),
                "amount": amt,
                "description": "Recurring services / goods disbursement",
                "_seeded_anomaly": "duplicate_payment",
            })

    # --- Seeded anomaly 2: extreme outlier amount for an existing vendor ---
    for _ in range(8):
        vid, vname, lo, hi = random.choice(VENDORS)
        dt = business_datetime(start, end)
        outlier_amt = round(hi * random.uniform(5, 9), 2)
        rows.append({
            "transaction_id": new_id(),
            "date": dt.strftime("%Y-%m-%d"),
            "time": dt.strftime("%H:%M"),
            "vendor_id": vid,
            "vendor_name": vname,
            "department": random.choice(DEPARTMENTS),
            "payment_type": random.choice(PAYMENT_TYPES),
            "amount": outlier_amt,
            "description": "One-time program disbursement",
            "_seeded_anomaly": "amount_outlier",
        })

    # --- Seeded anomaly 3: off-hours / weekend payments ---
    for _ in range(7):
        vid, vname, lo, hi = random.choice(VENDORS)
        d = start + timedelta(days=random.randint(0, (end - start).days))
        # force weekend or late-night
        if random.random() < 0.5:
            while d.weekday() < 5:
                d += timedelta(days=1)
            hour = random.randint(8, 20)
        else:
            hour = random.choice([0, 1, 2, 3, 22, 23])
        dt = d.replace(hour=hour, minute=random.randint(0, 59))
        rows.append({
            "transaction_id": new_id(),
            "date": dt.strftime("%Y-%m-%d"),
            "time": dt.strftime("%H:%M"),
            "vendor_id": vid,
            "vendor_name": vname,
            "department": random.choice(DEPARTMENTS),
            "payment_type": random.choice(PAYMENT_TYPES),
            "amount": rand_amount(lo, hi),
            "description": "Recurring services / goods disbursement",
            "_seeded_anomaly": "off_hours_timing",
        })

    # --- Seeded anomaly 4: brand-new, never-seen-before vendor with a large first payment ---
    for i, name in enumerate(ONE_OFF_VENDOR_NAMES):
        dt = business_datetime(start, end)
        rows.append({
            "transaction_id": new_id(),
            "date": dt.strftime("%Y-%m-%d"),
            "time": dt.strftime("%H:%M"),
            "vendor_id": f"V90{i+1}",
            "vendor_name": name,
            "department": random.choice(DEPARTMENTS),
            "payment_type": random.choice(PAYMENT_TYPES),
            "amount": rand_amount(25000, 80000),
            "description": "New vendor onboarding disbursement",
            "_seeded_anomaly": "new_vendor_large_first_payment",
        })

    # --- Seeded anomaly 5: amounts just under a common reporting threshold ($10,000) ---
    for _ in range(5):
        vid, vname, lo, hi = random.choice(VENDORS)
        dt = business_datetime(start, end)
        amt = round(random.uniform(9700, 9999), 2)
        rows.append({
            "transaction_id": new_id(),
            "date": dt.strftime("%Y-%m-%d"),
            "time": dt.strftime("%H:%M"),
            "vendor_id": vid,
            "vendor_name": vname,
            "department": random.choice(DEPARTMENTS),
            "payment_type": random.choice(PAYMENT_TYPES),
            "amount": amt,
            "description": "Program disbursement",
            "_seeded_anomaly": "just_under_threshold",
        })

    random.shuffle(rows)
    rows.sort(key=lambda r: (r["date"], r["time"]))

    seeded_count = sum(1 for r in rows if r["_seeded_anomaly"])
    print(f"Generated {len(rows)} rows ({seeded_count} seeded anomalies) -> {args.out}")

    fieldnames = ["transaction_id", "date", "time", "vendor_id", "vendor_name",
                  "department", "payment_type", "amount", "description"]

    import os
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r[k] for k in fieldnames})


if __name__ == "__main__":
    main()

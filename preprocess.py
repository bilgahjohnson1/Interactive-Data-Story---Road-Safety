#  Reads the accident.csv, vehicle.csv, person.csv from Victoria road crash CSVs app.
#  Cleans and normalises each dataset and saves as processed_accidents.csv, processed_persons.csv, processed_vehicles.csv into the folder for the web app.

import pandas as pd
import os
import sys

# Print section header
def section(title):
    print(f"\n{'─'*60}")
    print(f"  {title}")
    print(f"{'─'*60}")

# Load csv files.
section("1  Loading raw CSVs")
Datadir = "data"
for Namef in ["accident.csv", "vehicle.csv", "person.csv"]:
    path = os.path.join(Datadir, Namef)
    if not os.path.exists(path):
        print(f"{path} not found error. Please copy your CSV files into the folder.")
        sys.exit(1)
Acc = pd.read_csv(os.path.join(Datadir, "accident.csv"), low_memory=False)
Veh = pd.read_csv(os.path.join(Datadir, "vehicle.csv"),  low_memory=False)
Per = pd.read_csv(os.path.join(Datadir, "person.csv"),   low_memory=False)
print(f"  Loaded: accident={len(Acc):,}  vehicle={len(Veh):,}  person={len(Per):,}")
print(f"  Accident columns: {list(Acc.columns)}")

# Check for duplicates.
section("1.1 Checking for duplicates")
print("Accident duplicates :", Acc.duplicated().sum())
print("Vehicle duplicates :", Veh.duplicated().sum())
print("Person duplicates :", Per.duplicated().sum())
if "ACCIDENT_NO" in Acc.columns:
    print("Accident IDs duplicates:", Acc["ACCIDENT_NO"].duplicated().sum())

# Duplicate removal
Acc = Acc.drop_duplicates()
Veh = Veh.drop_duplicates()
Per = Per.drop_duplicates()
print("Duplicates removed.")

# 2. Accident data processing
section("2  Accident data processing")

# Choose relevant columns.
Accident_needed = [
    "ACCIDENT_NO", "ACCIDENT_DATE", "ACCIDENT_TIME",
    "SEVERITY", "DAY_WEEK_DESC", "SPEED_ZONE",
    "LIGHT_CONDITION", "NO_PERSONS_KILLED", "NO_PERSONS_INJ_2",
    "NO_PERSONS_NOT_INJ", "ROAD_GEOMETRY_DESC", "RMA"
]
Acc = Acc[[c for c in Accident_needed if c in Acc.columns]].copy()

# Extract year and month from date.
Acc["ACCIDENT_DATE"] = pd.to_datetime(Acc["ACCIDENT_DATE"], errors="coerce")
Acc["YEAR"]  = Acc["ACCIDENT_DATE"].dt.year
Acc["MONTH"] = Acc["ACCIDENT_DATE"].dt.month

# Extract hour from time.
if "ACCIDENT_TIME" in Acc.columns:
    Acc["HOUR"] = (
        pd.to_datetime(Acc["ACCIDENT_TIME"], format="%H:%M:%S", errors="coerce")
          .dt.hour
    )
else:
    Acc["HOUR"] = None

# Map severity codes to labels.
# 1 = Fatal, 2 = Serious injury, 3 = Other injury, 4 = Not injured
sev_map = {1: "Fatal", 2: "Serious Injury", 3: "Other Injury", 4: "Not Injured"}
Acc["SEVERITY_LABEL"] = (
    pd.to_numeric(Acc["SEVERITY"], errors="coerce")
      .map(sev_map)
      .fillna("Unknown")
)

# Clean numeric columns.
for Col in ["NO_PERSONS_KILLED", "NO_PERSONS_INJ_2", "NO_PERSONS_NOT_INJ", "SEVERITY"]:
    if Col in Acc.columns:
        Acc[Col] = pd.to_numeric(Acc[Col], errors="coerce").fillna(0).astype(int)

# Clean speed zone by keeping only 20–130 km/h range.
if "SPEED_ZONE" in Acc.columns:
    Acc["SPEED_ZONE"] = pd.to_numeric(Acc["SPEED_ZONE"], errors="coerce")
    Acc.loc[~Acc["SPEED_ZONE"].between(20, 130), "SPEED_ZONE"] = None

# Map day names to numbers (1=Mon … 7=Sun)
day_order = {
    "Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4,
    "Friday": 5, "Saturday": 6, "Sunday": 7
}
if "DAY_WEEK_DESC" in Acc.columns:
    Acc["DAY_WEEK_DESC"] = Acc["DAY_WEEK_DESC"].str.strip().str.title()
    Acc["DAY_OF_WEEK_NUM"] = Acc["DAY_WEEK_DESC"].map(day_order).fillna(0).astype(int)
 
# Drop rows with no accident number or year.
Acc = Acc.dropna(subset=["ACCIDENT_NO", "YEAR"])
Acc["YEAR"] = Acc["YEAR"].astype(int)
print(f"  Processed accidents: {len(Acc):,} rows")

# 3. Person data processing
section("3  Person data processing")
Person_needed = [
    "ACCIDENT_NO", "PERSON_ID", "AGE_GROUP", "SEX",
    "INJ_LEVEL", "INJ_LEVEL_DESC", "HELMET_BELT_WORN", "ROAD_USER_TYPE_DESC"
]
Per = Per[[c for c in Person_needed if c in Per.columns]].copy()

# Drop rows with no accident link.
Per = Per.dropna(subset=["ACCIDENT_NO"])

# Clean age group.
if "AGE_GROUP" in Per.columns:
    Per["AGE_GROUP"] = Per["AGE_GROUP"].str.strip().replace({"": None, "Unknown": None})
print(f"  Processed persons: {len(Per):,} rows")

# 4. Vehicle data processing
section("4  Vehicle data processing")
Vehicle_needed = [
    "ACCIDENT_NO", "VEHICLE_ID", "VEHICLE_TYPE_DESC", "VEHICLE_MAKE",
    "VEHICLE_YEAR_MANUF", "FUEL_TYPE", "LEVEL_OF_DAMAGE", "TRAFFIC_CONTROL_DESC"
]
Veh = Veh[[c for c in Vehicle_needed if c in Veh.columns]].copy()

# Drop rows with no accident link.
Veh = Veh.dropna(subset=["ACCIDENT_NO"])

# Clean vehicle year.
if "VEHICLE_YEAR_MANUF" in Veh.columns:
    Veh["VEHICLE_YEAR_MANUF"] = pd.to_numeric(Veh["VEHICLE_YEAR_MANUF"], errors="coerce")
    Veh.loc[~Veh["VEHICLE_YEAR_MANUF"].between(1900, 2026), "VEHICLE_YEAR_MANUF"] = None

# Clean vehicle type description.
if "VEHICLE_TYPE_DESC" in Veh.columns:
    Veh["VEHICLE_TYPE_DESC"] = Veh["VEHICLE_TYPE_DESC"].str.strip().str.title()
print(f"  Processed vehicles: {len(Veh):,} rows")

# 5. Output files
section("5  Output files")
Acc_out = os.path.join(Datadir, "processed_accidents.csv")
Per_out = os.path.join(Datadir, "processed_persons.csv")
Veh_out = os.path.join(Datadir, "processed_vehicles.csv")
Acc.to_csv(Acc_out, index=False)
Per.to_csv(Per_out, index=False)
Veh.to_csv(Veh_out, index=False)
print(f"  done {Acc_out}  ({len(Acc):,} rows)")
print(f"  done {Per_out}  ({len(Per):,} rows)")
print(f"  done {Veh_out}  ({len(Veh):,} rows)")

# 6. Summary statistics
section("6  Summary statistics")
print(f"  Date range:   {Acc['YEAR'].min()} - {Acc['YEAR'].max()}")
print(f"  Fatalities:   {Acc['NO_PERSONS_KILLED'].sum():,}")
if "SEVERITY_LABEL" in Acc.columns:
    print(f"  By severity:")
    for sev, cnt in Acc["SEVERITY_LABEL"].value_counts().items():
        print(f"    {sev:20s}: {cnt:,}")
if "DAY_WEEK_DESC" in Acc.columns:
    print(f"  By day of week (sorted):")
    Count_day = Acc.groupby(["DAY_OF_WEEK_NUM","DAY_WEEK_DESC"]).size().reset_index()
    Count_day = Count_day.sort_values("DAY_OF_WEEK_NUM")
    for _, row in Count_day.iterrows():
        print(f"    {row['DAY_WEEK_DESC']:12s}: {row[0]:,}")

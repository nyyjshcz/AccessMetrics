from fractions import Fraction
from reference_score import exact_score, half_up_tenths

SCENARIOS = {"A": ({"critical": 40, "serious": 30, "moderate": 20, "minor": 10}, 40), "B": ({"critical": 50, "serious": 30, "moderate": 20, "minor": 10}, 50), "C": ({"critical": 40, "serious": 25, "moderate": 15, "minor": 10}, 40)}

def sensitivity(sites):
    output = {}
    for name, (weights, maximum) in SCENARIOS.items():
        scores = {site: exact_score(rows, weights, maximum) for site, rows in sites.items()}
        scores = {site: value for site, value in scores.items() if value is not None}
        output[name] = {"scores": {site: {"exact": f"{value.numerator}/{value.denominator}", "display": half_up_tenths(value)} for site, value in scores.items()}, "ranking": sorted(scores, key=lambda site: (-scores[site], site))}
    return output

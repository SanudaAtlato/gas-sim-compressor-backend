import numpy as np
from scipy.optimize import curve_fit


def dr_saturation_exponential_model(C, DRmax, kC):
    """
    Model:
        DR = DRmax * (1 - exp(-kC * C))

    C unit  : ppm
    DR unit : fraction
    kC unit : 1/ppm
    """
    C = np.array(C, dtype=float)
    return DRmax * (1 - np.exp(-kC * C))


def fit_saturation_exponential_parameters(C_data, DR_data):
    C = np.array(C_data, dtype=float)
    DR = np.array(DR_data, dtype=float)

    DRmax_guess = max(DR)
    kC_guess = 0.005

    popt, _ = curve_fit(
        dr_saturation_exponential_model,
        C,
        DR,
        p0=[DRmax_guess, kC_guess],
        bounds=(0, np.inf)
    )

    DRmax, kC = popt

    DR_pred = dr_saturation_exponential_model(C, DRmax, kC)
    residuals = DR - DR_pred

    ss_res = np.sum(residuals ** 2)
    ss_tot = np.sum((DR - np.mean(DR)) ** 2)
    r2 = 1 - (ss_res / ss_tot)

    return {
        "model_name": "dr_saturation_exponential",
        "equation": "DR = DRmax * (1 - exp(-kC * C))",
        "DRmax": float(DRmax),
        "kC": float(kC),
        "kC_unit": "1/ppm",
        "R2": float(r2),
        "predicted_DR": DR_pred.tolist(),
        "residuals": residuals.tolist()
    }


def predict_dr_saturation_exponential(C, DRmax, kC):
    return dr_saturation_exponential_model(C, DRmax, kC)
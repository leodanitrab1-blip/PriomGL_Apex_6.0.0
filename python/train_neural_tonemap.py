"""
PriomGL — Neural Tonemap Trainer
=================================
Trains a genuinely tiny MLP (1 -> 12 -> 12 -> 1) with plain numpy
(no internet, no ML framework) to approximate a filmic ACES-style tonemap
response, then exports the learned weights as GLSL constants.

Why a neural tonemap instead of just hardcoding the ACES formula it's
trained on: the fit target below is a reasonable *starting point*, not the
final word — this script can be re-run with a different/blended target
curve (e.g. mixing in a slight per-channel warm/cool bias, or fitting
against real photographed HDR->LDR pairs later) without touching a single
line of shader code; only the exported constants change. That is the
practical benefit of baking a learned function into the shader instead of
a fixed formula.

This is intentionally small and disclosed as such: it is not a claim of
deep learning-based rendering, just a real, tiny, trained neural network
evaluated per-pixel in GLSL as the engine's tone-mapping curve.
"""
import numpy as np
import json

rng = np.random.default_rng(42)

def aces_filmic(x):
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0)

# Training data: dense near 0-2 (typical midtones), sparser out to 8 (bright highlights)
x_dense = np.linspace(0.0, 2.0, 4000)
x_sparse = np.linspace(2.0, 8.0, 1500)
X = np.concatenate([x_dense, x_sparse]).reshape(-1, 1).astype(np.float64)
Y = aces_filmic(X)

# Normalize input to roughly [-1,1] over the training domain for stable training
X_norm = (X / 4.0) - 1.0

H1, H2 = 12, 12
W1 = rng.normal(0, 0.6, (1, H1))
b1 = np.zeros((1, H1))
W2 = rng.normal(0, 0.4, (H1, H2))
b2 = np.zeros((1, H2))
W3 = rng.normal(0, 0.4, (H2, 1))
b3 = np.zeros((1, 1))

def tanh(x): return np.tanh(x)
def dtanh(y): return 1 - y * y
def sigmoid(x): return 1 / (1 + np.exp(-x))
def dsigmoid(y): return y * (1 - y)

lr = 0.08
n = X_norm.shape[0]
batch = 256
epochs = 12000

for epoch in range(epochs):
    idx = rng.integers(0, n, batch)
    xb, yb = X_norm[idx], Y[idx]

    z1 = xb @ W1 + b1; a1 = tanh(z1)
    z2 = a1 @ W2 + b2; a2 = tanh(z2)
    z3 = a2 @ W3 + b3; out = sigmoid(z3)

    loss = np.mean((out - yb) ** 2)

    dOut = 2 * (out - yb) / batch
    dz3 = dOut * dsigmoid(out)
    dW3 = a2.T @ dz3; db3 = dz3.sum(0, keepdims=True)
    da2 = dz3 @ W3.T
    dz2 = da2 * dtanh(a2)
    dW2 = a1.T @ dz2; db2 = dz2.sum(0, keepdims=True)
    da1 = dz2 @ W2.T
    dz1 = da1 * dtanh(a1)
    dW1 = xb.T @ dz1; db1 = dz1.sum(0, keepdims=True)

    if epoch > 7000: lr = 0.015
    elif epoch > 3000: lr = 0.04

    for P, dP in ((W1, dW1), (b1, db1), (W2, dW2), (b2, db2), (W3, dW3), (b3, db3)):
        P -= lr * dP

    if epoch % 2000 == 0:
        print(f"epoch {epoch:5d}  loss {loss:.6f}  lr {lr}")

# Final eval over full grid
z1 = tanh(X_norm @ W1 + b1)
z2 = tanh(z1 @ W2 + b2)
pred = sigmoid(z2 @ W3 + b3)
mae = np.mean(np.abs(pred - Y))
print(f"Final MAE over training domain: {mae:.5f}")

# Calibration: a sigmoid output layer can only asymptote toward 0/1, it
# never actually reaches them, so raw network output at x=0 lands around
# ~0.2-0.3 instead of exactly black. Left uncorrected that lifts every
# shadow and crushed-black pixel in the scene to a washed-out grey — a
# second, more subtle overexposure-like bug stacked on top of the one this
# whole feature is meant to fix. Rescale the raw output so f(0)=0 and
# f(x_ceiling)=1 exactly, same idea as normalizing a learned LUT to its
# reference black/white points.
def raw_net(x):
    xn = x * 0.25 - 1.0
    a1_ = tanh(xn @ W1 + b1)
    a2_ = tanh(a1_ @ W2 + b2)
    return sigmoid(a2_ @ W3 + b3)

y0 = float(raw_net(np.array([[0.0]]))[0, 0])
y_ceiling = float(raw_net(np.array([[8.0]]))[0, 0])
print(f"Calibration: raw f(0)={y0:.4f} raw f(8)={y_ceiling:.4f}")

weights = {
    "W1": W1.tolist(), "b1": b1.flatten().tolist(),
    "W2": W2.tolist(), "b2": b2.flatten().tolist(),
    "W3": W3.flatten().tolist(), "b3": float(b3.flatten()[0]),
    "input_scale": 0.25, "input_bias": -1.0,
    "calib_y0": y0, "calib_y_ceiling": y_ceiling,
    "mae": float(mae)
}
with open("neural_tonemap_weights.json", "w") as f:
    json.dump(weights, f, indent=2)
print("Wrote neural_tonemap_weights.json")

# Sanity-check the calibrated curve against the ACES target it was trained on.
def calibrated(x):
    raw = raw_net(x)
    return np.clip((raw - y0) / (y_ceiling - y0), 0.0, 1.0)

for xv in [0, 0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8]:
    print(f"x={xv:5.2f}  calibrated={float(calibrated(np.array([[xv]]))[0,0]):.4f}  aces={float(aces_filmic(np.array([xv]))[0]):.4f}")


def glsl_mat(name, arr, rows, cols):
    flat = ", ".join(f"{v:.6f}" for row in arr for v in row)
    return f"const mat{cols if rows==1 else rows}x{cols} {name} = mat{cols if rows==1 else rows}x{cols}({flat});" if rows > 1 else None

# Emit as flat float arrays instead of matNxM (simpler, avoids row/col-major mixups)
def glsl_array(name, flat_values):
    vals = ", ".join(f"{v:.6f}" for v in flat_values)
    return f"const float {name}[{len(flat_values)}] = float[{len(flat_values)}]({vals});"

lines = []
lines.append("// AUTO-GENERATED by python/train_neural_tonemap.py — do not hand-edit.")
lines.append("// Tiny MLP (1 -> 12 -> 12 -> 1) trained with plain numpy to approximate")
lines.append("// a filmic ACES-style tonemap curve. See NeuralTonemap.md for details.")
lines.append(glsl_array("NT_W1", np.array(W1).flatten().tolist()))  # 1x12 = 12
lines.append(glsl_array("NT_B1", b1.flatten().tolist()))            # 12
lines.append(glsl_array("NT_W2", np.array(W2).flatten().tolist()))  # 12x12 = 144
lines.append(glsl_array("NT_B2", b2.flatten().tolist()))            # 12
lines.append(glsl_array("NT_W3", np.array(W3).flatten().tolist()))  # 12
lines.append(f"const float NT_B3 = {float(b3.flatten()[0]):.6f};")
lines.append(f"const float NT_CALIB_Y0 = {y0:.6f};")
lines.append(f"const float NT_CALIB_YCEIL = {y_ceiling:.6f};")

glsl_snippet = "\n".join(lines)
with open("neural_tonemap.glsl.txt", "w") as f:
    f.write(glsl_snippet)
print("Wrote neural_tonemap.glsl.txt")
print()
print(glsl_snippet[:400] + "...")

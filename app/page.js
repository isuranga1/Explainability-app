"use client";

import { useEffect, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Line } from "react-konva";

const thStyle = {
  textAlign: "left",
  borderBottom: "1px solid #ddd",
  padding: "0.3rem",
};
const tdStyle = {
  padding: "0.3rem",
};

export default function Page() {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";

  // ===== Shared upload state =====
  const [file, setFile] = useState(null);
  const [originalUrl, setOriginalUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  // ===== Heatmap & LRP perturbation state =====
  const [heatmapUrl, setHeatmapUrl] = useState(null);
  const [targetIndex, setTargetIndex] = useState(""); // string input
  const [originalPrediction, setOriginalPrediction] = useState(null);
  const [positiveResults, setPositiveResults] = useState([]);
  const [negativeResults, setNegativeResults] = useState([]);

  const [loadingHeatmap, setLoadingHeatmap] = useState(false);
  const [loadingPosPert, setLoadingPosPert] = useState(false);
  const [loadingNegPert, setLoadingNegPert] = useState(false);

  // ===== Canvas-based perturbation (Konva, freehand mask) =====
  const [konvaImage, setKonvaImage] = useState(null);
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
  const [maskLines, setMaskLines] = useState([]); // array of {points: []}
  const [isDrawingMask, setIsDrawingMask] = useState(false);

  const [perturbedUrl, setPerturbedUrl] = useState(null);
  const [inferenceResults, setInferenceResults] = useState([]);
  const [loadingInfer, setLoadingInfer] = useState(false);

  const stageWidth = 500; // displayed width

  // Load image for Konva when originalUrl changes
  useEffect(() => {
    if (!originalUrl) {
      setKonvaImage(null);
      setImgSize({ width: 0, height: 0 });
      return;
    }
    const img = new window.Image();
    img.src = originalUrl;
    img.onload = () => {
      setKonvaImage(img);
      const aspect = img.height / img.width;
      setImgSize({
        width: stageWidth,
        height: stageWidth * aspect,
      });
    };
  }, [originalUrl]);

  // ===== File upload handler =====
  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    const url = URL.createObjectURL(selected);
    setOriginalUrl(url);

    // reset outputs
    setHeatmapUrl(null);
    setOriginalPrediction(null);
    setPositiveResults([]);
    setNegativeResults([]);
    setMaskLines([]);
    setPerturbedUrl(null);
    setInferenceResults([]);
    setErrorMsg("");
  };

  // ===== Heatmap endpoint =====
  const handleGenerateHeatmap = async () => {
    if (!file) {
      setErrorMsg("Please select an image first.");
      return;
    }

    setLoadingHeatmap(true);
    setErrorMsg("");
    setHeatmapUrl(null);

    try {
      const formData = new FormData();
      formData.append("image", file);
      if (targetIndex.trim() !== "") {
        formData.append("target_index", targetIndex.trim());
      }

      const res = await fetch(`${API_BASE}/api/heatmap`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let msg = `Heatmap request failed: ${res.status}`;
        try {
          const d = await res.json();
          if (d.error) msg = d.error;
        } catch (_) {}
        throw new Error(msg);
      }

      const blob = await res.blob();
      setHeatmapUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Something went wrong");
    } finally {
      setLoadingHeatmap(false);
    }
  };

  // ===== LRP perturbation helper (positive / negative) =====
  const runPerturbation = async (perturbationType) => {
    if (!file) {
      setErrorMsg("Please select an image first.");
      return;
    }

    if (perturbationType === "positive") setLoadingPosPert(true);
    if (perturbationType === "negative") setLoadingNegPert(true);

    setErrorMsg("");

    try {
      const formData = new FormData();
      formData.append("image", file);
      if (targetIndex.trim() !== "") {
        formData.append("target_index", targetIndex.trim());
      }
      formData.append("perturbation_type", perturbationType);

      const res = await fetch(`${API_BASE}/api/perturbation`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let msg = `Perturbation (${perturbationType}) failed: ${res.status}`;
        try {
          const d = await res.json();
          if (d.error) msg = d.error;
        } catch (_) {}
        throw new Error(msg);
      }

      const data = await res.json();
      setOriginalPrediction(data.original_prediction || null);

      if (perturbationType === "positive") {
        setPositiveResults(data.perturbation_results || []);
      } else {
        setNegativeResults(data.perturbation_results || []);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Something went wrong");
    } finally {
      if (perturbationType === "positive") setLoadingPosPert(false);
      if (perturbationType === "negative") setLoadingNegPert(false);
    }
  };

  const handlePositivePerturbation = () => runPerturbation("positive");
  const handleNegativePerturbation = () => runPerturbation("negative");

  // ===== Konva handlers: freehand mask drawing =====
  const handleMaskMouseDown = (e) => {
    if (!konvaImage) return;
    const pos = e.target.getStage().getPointerPosition();
    setIsDrawingMask(true);
    // start a new line
    setMaskLines((lines) => [
      ...lines,
      {
        points: [pos.x, pos.y],
      },
    ]);
  };

  const handleMaskMouseMove = (e) => {
    if (!isDrawingMask) return;
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    setMaskLines((lines) => {
      const lastLine = lines[lines.length - 1];
      const newPoints = lastLine.points.concat([point.x, point.y]);
      const newLines = lines.slice(0, lines.length - 1);
      return [...newLines, { ...lastLine, points: newPoints }];
    });
  };

  const handleMaskMouseUp = () => {
    setIsDrawingMask(false);
  };

  // ===== Apply canvas-based perturbation using freehand mask =====
  const handleApplyCanvasPerturbation = () => {
    if (!konvaImage || maskLines.length === 0) {
      setErrorMsg("Draw a mask on the image first (paint over the region).");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = imgSize.width;
    canvas.height = imgSize.height;
    const ctx = canvas.getContext("2d");

    // Draw original image scaled to canvas
    ctx.drawImage(konvaImage, 0, 0, imgSize.width, imgSize.height);

    // Draw mask strokes as occlusion (black)
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 25; // brush thickness – adjust as needed

    maskLines.forEach((line) => {
      const pts = line.points;
      if (pts.length < 4) return;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo(pts[i], pts[i + 1]);
      }
      ctx.stroke();
    });
    ctx.restore();

    const dataUrl = canvas.toDataURL("image/png");
    setPerturbedUrl(dataUrl);
    setInferenceResults([]);
    setErrorMsg("");
  };

  // ===== Run inference on perturbed image (/api/infer) =====
  const handleRunInferencePerturbed = async () => {
    if (!perturbedUrl) {
      setErrorMsg("Apply a canvas perturbation first.");
      return;
    }

    setLoadingInfer(true);
    setErrorMsg("");
    setInferenceResults([]);

    try {
      const resBlob = await fetch(perturbedUrl);
      const blob = await resBlob.blob();

      const formData = new FormData();
      formData.append("image", blob, "perturbed.png");

      const res = await fetch(`${API_BASE}/api/infer`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let msg = `Inference failed: ${res.status}`;
        try {
          const d = await res.json();
          if (d.error) msg = d.error;
        } catch (_) {}
        throw new Error(msg);
      }

      const data = await res.json();
      setInferenceResults(data.predictions || []);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Something went wrong");
    } finally {
      setLoadingInfer(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "2rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
        alignItems: "center",
        background: "#f5f5f5",
      }}
    >
      <h1>
        ViT-LRP Explorer: Heatmaps, LRP Perturbations & Mask-based Occlusion
      </h1>

      {/* Controls (upload + target index + 3 buttons) */}
      <div
        style={{
          background: "white",
          padding: "1.5rem",
          borderRadius: "0.75rem",
          boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
          width: "100%",
          maxWidth: 900,
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        <label style={{ fontSize: "0.9rem" }}>
          Image:
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: "block", marginTop: "0.25rem" }}
          />
        </label>

        <label style={{ fontSize: "0.9rem" }}>
          Target class index (0–999, optional):
          <input
            type="number"
            min={0}
            max={999}
            value={targetIndex}
            onChange={(e) => setTargetIndex(e.target.value)}
            placeholder="Leave empty to use model top-1 as target"
            style={{
              marginTop: "0.25rem",
              padding: "0.3rem 0.5rem",
              borderRadius: "0.4rem",
              border: "1px solid #ccc",
              width: "240px",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button
            onClick={handleGenerateHeatmap}
            disabled={loadingHeatmap || !file}
            style={{
              padding: "0.6rem 1.1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#1f2937",
              color: "white",
              cursor: loadingHeatmap || !file ? "not-allowed" : "pointer",
              opacity: loadingHeatmap || !file ? 0.6 : 1,
            }}
          >
            {loadingHeatmap ? "Generating heatmap..." : "Generate Heatmap"}
          </button>

          <button
            onClick={handlePositivePerturbation}
            disabled={loadingPosPert || !file}
            style={{
              padding: "0.6rem 1.1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#16a34a",
              color: "white",
              cursor: loadingPosPert || !file ? "not-allowed" : "pointer",
              opacity: loadingPosPert || !file ? 0.6 : 1,
            }}
          >
            {loadingPosPert
              ? "Running + perturbation..."
              : "Positive Perturbation"}
          </button>

          <button
            onClick={handleNegativePerturbation}
            disabled={loadingNegPert || !file}
            style={{
              padding: "0.6rem 1.1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#dc2626",
              color: "white",
              cursor: loadingNegPert || !file ? "not-allowed" : "pointer",
              opacity: loadingNegPert || !file ? 0.6 : 1,
            }}
          >
            {loadingNegPert
              ? "Running - perturbation..."
              : "Negative Perturbation"}
          </button>
        </div>

        {errorMsg && (
          <p style={{ color: "red", marginTop: "0.5rem" }}>{errorMsg}</p>
        )}
      </div>

      {/* Original + Heatmap */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1.5rem",
          justifyContent: "center",
          width: "100%",
          maxWidth: 900,
        }}
      >
        {originalUrl && (
          <div>
            <h3>Original image</h3>
            <img
              src={originalUrl}
              alt="original"
              style={{
                maxWidth: 400,
                maxHeight: 400,
                objectFit: "contain",
                borderRadius: "0.5rem",
                background: "white",
                boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
              }}
            />
          </div>
        )}

        {heatmapUrl && (
          <div>
            <h3>Heatmap (LRP)</h3>
            <img
              src={heatmapUrl}
              alt="heatmap"
              style={{
                maxWidth: 400,
                maxHeight: 400,
                objectFit: "contain",
                borderRadius: "0.5rem",
                background: "white",
                boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
              }}
            />
          </div>
        )}
      </div>

      {/* LRP perturbation analysis */}
      {(originalPrediction ||
        positiveResults.length > 0 ||
        negativeResults.length > 0) && (
        <div
          style={{
            marginTop: "1rem",
            background: "white",
            padding: "1rem 1.5rem",
            borderRadius: "0.75rem",
            boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
            width: "100%",
            maxWidth: 1000,
          }}
        >
          <h3>LRP-based Perturbation Analysis</h3>

          {originalPrediction && (
            <>
              <p style={{ marginTop: "0.5rem" }}>
                <strong>Top-1 (original):</strong>{" "}
                {originalPrediction.top1.class_name} (idx{" "}
                {originalPrediction.top1.class_idx}) —{" "}
                {(originalPrediction.top1.prob * 100).toFixed(2)}%
              </p>
              <p>
                <strong>Target class:</strong>{" "}
                {originalPrediction.target.class_name} (idx{" "}
                {originalPrediction.target.class_idx}) —{" "}
                {(originalPrediction.target.prob * 100).toFixed(2)}%
              </p>
            </>
          )}

          {positiveResults.length > 0 && (
            <>
              <h4 style={{ marginTop: "1rem" }}>
                Positive perturbation (mask high-importance pixels)
              </h4>
              <table
                style={{
                  width: "100%",
                  marginTop: "0.5rem",
                  borderCollapse: "collapse",
                  fontSize: "0.9rem",
                }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>Fraction perturbed</th>
                    <th style={thStyle}>Top-1 class</th>
                    <th style={thStyle}>Top-1 prob</th>
                    <th style={thStyle}>Target prob</th>
                  </tr>
                </thead>
                <tbody>
                  {positiveResults.map((r) => (
                    <tr key={`pos-${r.fraction}`}>
                      <td style={tdStyle}>{(r.fraction * 100).toFixed(0)}%</td>
                      <td style={tdStyle}>
                        {r.top1_class_name} (idx {r.top1_class_idx})
                      </td>
                      <td style={tdStyle}>{(r.top1_prob * 100).toFixed(2)}%</td>
                      <td style={tdStyle}>
                        {(r.target_prob * 100).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {negativeResults.length > 0 && (
            <>
              <h4 style={{ marginTop: "1rem" }}>
                Negative perturbation (mask low-importance pixels)
              </h4>
              <table
                style={{
                  width: "100%",
                  marginTop: "0.5rem",
                  borderCollapse: "collapse",
                  fontSize: "0.9rem",
                }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>Fraction perturbed</th>
                    <th style={thStyle}>Top-1 class</th>
                    <th style={thStyle}>Top-1 prob</th>
                    <th style={thStyle}>Target prob</th>
                  </tr>
                </thead>
                <tbody>
                  {negativeResults.map((r) => (
                    <tr key={`neg-${r.fraction}`}>
                      <td style={tdStyle}>{(r.fraction * 100).toFixed(0)}%</td>
                      <td style={tdStyle}>
                        {r.top1_class_name} (idx {r.top1_class_idx})
                      </td>
                      <td style={tdStyle}>{(r.top1_prob * 100).toFixed(2)}%</td>
                      <td style={tdStyle}>
                        {(r.target_prob * 100).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* Konva mask section */}
      <div
        style={{
          marginTop: "1rem",
          width: "100%",
          maxWidth: 1100,
          display: "flex",
          flexWrap: "wrap",
          gap: "1.5rem",
          justifyContent: "center",
        }}
      >
        {/* Canvas with freehand mask */}
        <div style={{ flex: "1 1 400px", minWidth: 320 }}>
          <h3>Mask-based Perturbation (paint a segmentation-like region)</h3>
          <p style={{ fontSize: "0.85rem", color: "#555" }}>
            Draw over the image with your mouse. The painted region will be
            occluded (set to black) for inference.
          </p>
          <div
            style={{
              borderRadius: "0.5rem",
              overflow: "hidden",
              background: "white",
              boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
              marginTop: "0.5rem",
            }}
          >
            {konvaImage && imgSize.width > 0 && imgSize.height > 0 ? (
              <Stage
                width={imgSize.width}
                height={imgSize.height}
                onMouseDown={handleMaskMouseDown}
                onMouseMove={handleMaskMouseMove}
                onMouseUp={handleMaskMouseUp}
                style={{ cursor: "crosshair" }}
              >
                <Layer>
                  <KonvaImage
                    image={konvaImage}
                    x={0}
                    y={0}
                    width={imgSize.width}
                    height={imgSize.height}
                  />
                </Layer>
                <Layer>
                  {maskLines.map((line, idx) => (
                    <Line
                      key={idx}
                      points={line.points}
                      stroke="red"
                      strokeWidth={20}
                      tension={0.5}
                      lineCap="round"
                      lineJoin="round"
                      opacity={0.6}
                    />
                  ))}
                </Layer>
              </Stage>
            ) : (
              <div style={{ padding: "2rem", textAlign: "center" }}>
                Upload an image to start drawing.
              </div>
            )}
          </div>

          <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
            <button
              onClick={handleApplyCanvasPerturbation}
              disabled={!originalUrl || maskLines.length === 0}
              style={{
                padding: "0.6rem 1.1rem",
                borderRadius: "0.5rem",
                border: "none",
                background: "#1d4ed8",
                color: "white",
                cursor:
                  !originalUrl || maskLines.length === 0
                    ? "not-allowed"
                    : "pointer",
                opacity: !originalUrl || maskLines.length === 0 ? 0.6 : 1,
              }}
            >
              Apply Mask Perturbation
            </button>

            <button
              onClick={handleRunInferencePerturbed}
              disabled={!perturbedUrl || loadingInfer}
              style={{
                padding: "0.6rem 1.1rem",
                borderRadius: "0.5rem",
                border: "none",
                background: "#16a34a",
                color: "white",
                cursor:
                  !perturbedUrl || loadingInfer ? "not-allowed" : "pointer",
                opacity: !perturbedUrl || loadingInfer ? 0.6 : 1,
              }}
            >
              {loadingInfer ? "Running inference..." : "Infer on Masked Image"}
            </button>
          </div>
        </div>

        {/* Preview + inference results */}
        <div style={{ flex: "1 1 350px", minWidth: 320 }}>
          <h3>Original & Mask-Perturbed Preview</h3>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {originalUrl && (
              <div>
                <p>Original</p>
                <img
                  src={originalUrl}
                  alt="original-preview"
                  style={{
                    maxWidth: 250,
                    maxHeight: 250,
                    objectFit: "contain",
                    borderRadius: "0.5rem",
                    background: "white",
                    boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
                  }}
                />
              </div>
            )}
            {perturbedUrl && (
              <div>
                <p>Perturbed (mask)</p>
                <img
                  src={perturbedUrl}
                  alt="perturbed-preview"
                  style={{
                    maxWidth: 250,
                    maxHeight: 250,
                    objectFit: "contain",
                    borderRadius: "0.5rem",
                    background: "white",
                    boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
                  }}
                />
              </div>
            )}
          </div>

          {inferenceResults.length > 0 && (
            <div
              style={{
                marginTop: "1rem",
                background: "white",
                padding: "0.75rem 1rem",
                borderRadius: "0.75rem",
                boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
              }}
            >
              <h4>Inference on Mask-Perturbed Image (Top-5)</h4>
              <table
                style={{
                  width: "100%",
                  marginTop: "0.5rem",
                  borderCollapse: "collapse",
                  fontSize: "0.9rem",
                }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>Rank</th>
                    <th style={thStyle}>Class</th>
                    <th style={thStyle}>Prob</th>
                  </tr>
                </thead>
                <tbody>
                  {inferenceResults.map((r, idx) => (
                    <tr key={`${r.class_idx}-${idx}`}>
                      <td style={tdStyle}>{idx + 1}</td>
                      <td style={tdStyle}>
                        {r.class_name} (idx {r.class_idx})
                      </td>
                      <td style={tdStyle}>{(r.prob * 100).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

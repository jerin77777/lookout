import { useState, useEffect, useRef } from "react";
import {
  Upload,
  Sparkles,
  Camera,
  Play,
  AlertCircle,
  Cpu,
  Smile,
  FileImage,
} from "lucide-react";
import { generateAvatar, getVramStatus } from "./services/api";
import type { StepDetail, GetVramStatusResponse } from "./services/arri_client.rpc";
import { VramMonitor } from "./components/VramMonitor";
import { PipelineTracker } from "./components/PipelineTracker";
import { AvatarViewer3D } from "./components/AvatarViewer3D";
import "./App.css";

export function App() {
  // Input State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [characterStyle, setCharacterStyle] = useState<string>("pixar_3d");
  const [meshQuality, setMeshQuality] = useState<string>("high");

  // Job / Pipeline State
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [, setJobId] = useState<string | null>(null);
  const [progressPercent, setProgressPercent]
    = useState<number>(0);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [steps, setSteps] = useState<StepDetail[]>([
    { stepId: 1, name: "User Photograph Preprocessing", description: "Face crop, 468 landmark alignment & lighting normalization", status: "pending", durationMs: 0, vramUsedMb: 0, logDetail: "" },
    { stepId: 2, name: "Pixar AI Stylization", description: "FLUX 8-bit / SDXL Pixar LoRA diffusion with neutral expression", status: "pending", durationMs: 0, vramUsedMb: 0, logDetail: "" },
    { stepId: 3, name: "Multi-View Generation", description: "Synthesize consistent 4-angle orthographic perspective views", status: "pending", durationMs: 0, vramUsedMb: 0, logDetail: "" },
    { stepId: 4, name: "Image-to-3D (Hunyuan3D)", description: "Neural surface reconstruction into high-poly 3D mesh", status: "pending", durationMs: 0, vramUsedMb: 0, logDetail: "" },
    { stepId: 5, name: "Automatic Mesh Processing", description: "Head/body segmentation & ARKit canonical edge-loop retopology", status: "pending", durationMs: 0, vramUsedMb: 0, logDetail: "" },
    { stepId: 6, name: "AI Facial Rigging (ARKit 52)", description: "FLAME deformation transfer mapping 52 Apple ARKit blendshapes", status: "pending", durationMs: 0, vramUsedMb: 0, logDetail: "" },
    { stepId: 7, name: "Automatic Body Rigging", description: "Humanoid skeleton alignment & geodesic skinning weights", status: "pending", durationMs: 0, vramUsedMb: 0, logDetail: "" },
    { stepId: 8, name: "Animation-Ready GLB Export", description: "Assemble 52 morph targets + skinned skeleton + textures into GLB", status: "pending", durationMs: 0, vramUsedMb: 0, logDetail: "" },
  ]);

  // Output State
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [stylizedImageUrl, setStylizedImageUrl] = useState<string | null>(null);
  const [peakVramMb, setPeakVramMb] = useState<number>(6400.0);
  const [vramInfo, setVramInfo] = useState<GetVramStatusResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll VRAM info on load
  useEffect(() => {
    getVramStatus()
      .then((info) => setVramInfo(info))
      .catch((e) => console.warn("Could not query VRAM status:", e));
  }, []);

  // Handle Image File Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setErrorMsg(null);
    }
  };

  // Convert File to Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Run the 8-Stage AI Pipeline via Arri RPC
  const handleStartPipeline = async () => {
    if (!selectedFile && !previewUrl) {
      setErrorMsg("Please select or drop a portrait photograph first.");
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);
    setProgressPercent(5);
    setCurrentStep(1);

    try {
      let base64Data = "";
      if (selectedFile) {
        base64Data = await fileToBase64(selectedFile);
      } else {
        // Fallback default sample base64 portrait
        base64Data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQIW2P8z/D/PwMDAwMDEwMAAKoDAz52hD8AAAAASUVORK5CYII=";
      }

      // Call Arri RPC procedure: avatar.generate
      const response = await generateAvatar(
        base64Data,
        selectedFile ? selectedFile.name : "portrait.jpg",
        characterStyle,
        meshQuality
      );

      if (!response.success && response.error) {
        throw new Error(response.error);
      }

      if (response.jobId) setJobId(response.jobId);
      if (response.progressPercent !== undefined) setProgressPercent(response.progressPercent);
      if (response.currentStep !== undefined) setCurrentStep(response.currentStep);
      if (response.steps) setSteps(response.steps);
      if (response.vramPeakMb !== undefined) setPeakVramMb(response.vramPeakMb);

      if (response.glbUrl) {
        setGlbUrl(response.glbUrl);
      }
      if (response.stylizedImageUrl) {
        setStylizedImageUrl(response.stylizedImageUrl);
      }

      // Refresh VRAM Telemetry
      getVramStatus().then((info) => setVramInfo(info)).catch(() => { });
    } catch (err: any) {
      console.error("Pipeline run error:", err);
      setErrorMsg(err.message || "Failed to run AI pipeline. Check backend connection.");
    } finally {
      setIsProcessing(false);
    }
  };

  // One-click quick demo with a sample portrait
  const handleUseDemoSample = () => {
    // Generate an illustrative demo portrait preview
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(0, 0, 512, 512);
      ctx.fillStyle = "#fbcfe8";
      ctx.beginPath();
      ctx.arc(256, 240, 140, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1e293b";
      ctx.font = "20px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Front-Facing Portrait", 256, 250);
      const dataUrl = canvas.toDataURL("image/jpeg");
      setPreviewUrl(dataUrl);
      setSelectedFile(null);
      setErrorMsg(null);
    }
  };

  return (
    <div className="app-layout">
      {/* Top Studio Navbar */}
      <header className="app-header">
        <div className="header-left">
          <div className="brand-badge">
            <Sparkles size={20} className="icon-pulse" />
          </div>
          <div>
            <h1>Pixar 3D Avatar Creator</h1>
            <p className="subtitle">
              Single-Photo → Pixar Stylization → Hunyuan3D → 52 ARKit Facial Blendshapes & Humanoid Rig
            </p>
          </div>
        </div>

        <div className="header-right">
          <div className="hardware-tag">
            <Cpu size={16} />
            <span>NVIDIA RTX 3060 (12 GB VRAM)</span>
          </div>
          <div className="rpc-tag">
            <span>Arri RPC v1.0</span>
          </div>
        </div>
      </header>

      {/* Main Studio Workspace */}
      <main className="studio-grid">
        {/* Left Column: Input, Pipeline Config, VRAM & Step Tracker */}
        <section className="left-panel">
          {/* Photograph Upload & Picker */}
          <div className="card input-card">
            <div className="card-header">
              <Camera size={18} />
              <h3>01. Input Portrait Photograph</h3>
            </div>

            <div
              className={`dropzone ${previewUrl ? "has-preview" : ""}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />

              {previewUrl ? (
                <div className="preview-container">
                  <img src={previewUrl} alt="Portrait Preview" className="portrait-img" />
                  <div className="portrait-guide-overlay">
                    <div className="guide-oval" />
                    <span>Eye level guideline</span>
                  </div>
                  <button
                    className="change-photo-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    Change Image
                  </button>
                </div>
              ) : (
                <div className="dropzone-empty">
                  <Upload size={36} className="text-muted" />
                  <p className="primary-text">Click or drag & drop a front portrait</p>
                  <p className="hint-text">Clear neutral expression, head & shoulders visible</p>
                </div>
              )}
            </div>

            <div className="sample-quick-pick">
              <span>Or test with a sample:</span>
              <button
                type="button"
                className="sample-btn"
                onClick={handleUseDemoSample}
              >
                <FileImage size={14} /> <span>Load Sample Portrait</span>
              </button>
            </div>

            {/* Pipeline Configuration Options */}
            <div className="config-grid">
              <div className="config-item">
                <label>Pixar Character Style</label>
                <select
                  value={characterStyle}
                  onChange={(e) => setCharacterStyle(e.target.value)}
                  disabled={isProcessing}
                >
                  <option value="pixar_3d">Pixar 3D Feature Film</option>
                  <option value="disney_classic">Disney Modern 3D</option>
                  <option value="stylized_chibi">Stylized Expressive Chibi</option>
                </select>
              </div>

              <div className="config-item">
                <label>Mesh Topology Target</label>
                <select
                  value={meshQuality}
                  onChange={(e) => setMeshQuality(e.target.value)}
                  disabled={isProcessing}
                >
                  <option value="high">High (14,280 Quad-Dominant Tris)</option>
                  <option value="standard">Standard (8,500 Tris)</option>
                  <option value="ultra">Ultra Fidelity (24,000 Tris)</option>
                </select>
              </div>
            </div>

            {/* CTA Button */}
            <button
              className={`cta-start-btn ${isProcessing ? "loading" : ""}`}
              onClick={handleStartPipeline}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <div className="spinner" />
                  <span>Executing Stage 0{currentStep} / 08...</span>
                </>
              ) : (
                <>
                  <Play size={18} />
                  <span>Generate Animation-Ready Avatar</span>
                </>
              )}
            </button>

            {errorMsg && (
              <div className="error-banner">
                <AlertCircle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* VRAM Telemetry Widget */}
          <VramMonitor vramInfo={vramInfo} peakVramMb={peakVramMb} />

          {/* 8-Stage Pipeline Execution Tracker */}
          <PipelineTracker
            steps={steps}
            currentStep={currentStep}
            progressPercent={progressPercent}
            status={isProcessing ? "processing" : glbUrl ? "completed" : "idle"}
          />
        </section>

        {/* Right Column: 3D Avatar Inspector with 52 ARKit Blendshapes & Emotion Presets */}
        <section className="right-panel">
          <div className="card viewport-card">
            <div className="card-header">
              <Smile size={18} />
              <h3>Interactive 3D WebGL Avatar & ARKit Rigging Inspector</h3>
              <div className="header-tags">
                <span className="pill-tag">52 ARKit Blendshapes</span>
                <span className="pill-tag">Humanoid Rigging</span>
                <span className="pill-tag">glTF 2.0 Binary</span>
              </div>
            </div>

            <AvatarViewer3D
              glbUrl={glbUrl}
              stylizedImageUrl={stylizedImageUrl}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;

import React from "react";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Sparkles,
  Camera,
  Layers,
  Box,
  Smile,
  Bone,
  Download,
} from "lucide-react";
import type { StepDetail } from "../services/arri_client.rpc";

interface PipelineTrackerProps {
  steps: StepDetail[];
  currentStep: number;
  progressPercent: number;
  status: string;
}

const STEP_ICONS: Record<number, React.ReactNode> = {
  1: <Camera size={18} />,
  2: <Sparkles size={18} />,
  3: <Layers size={18} />,
  4: <Box size={18} />,
  5: <Layers size={18} />,
  6: <Smile size={18} />,
  7: <Bone size={18} />,
  8: <Download size={18} />,
};

export const PipelineTracker: React.FC<PipelineTrackerProps> = ({
  steps,
  currentStep,
  progressPercent,
  status: _status,
}) => {
  return (
    <div className="pipeline-tracker-card">
      <div className="tracker-header">
        <div>
          <h3>Pipeline Execution Stages</h3>
          <p className="subtitle">
            8-Stage Pixar Photorealistic Stylization & ARKit Rigging Pipeline
          </p>
        </div>
        <div className="progress-badge">
          <span>{progressPercent}% Complete</span>
        </div>
      </div>

      <div className="pipeline-bar-wrapper">
        <div className="pipeline-bar-track">
          <div
            className="pipeline-bar-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="steps-list">
        {steps.map((step) => {
          const isDone = step.status === "completed";
          const isRunning = step.status === "running";
          const isFailed = step.status === "failed";
          const duration = step.durationMs ?? 0;
          const vramUsed = step.vramUsedMb ?? 0;

          return (
            <div
              key={step.stepId}
              className={`step-item ${step.status} ${
                currentStep === step.stepId ? "active" : ""
              }`}
            >
              <div className="step-icon-col">
                <div className={`step-circle ${step.status}`}>
                  {isDone ? (
                    <CheckCircle2 size={16} className="text-green" />
                  ) : isRunning ? (
                    <Loader2 size={16} className="icon-spin text-blue" />
                  ) : isFailed ? (
                    <AlertCircle size={16} className="text-red" />
                  ) : (
                    STEP_ICONS[step.stepId] || <Clock size={16} />
                  )}
                </div>
                {step.stepId < steps.length && (
                  <div
                    className={`step-connector ${
                      isDone ? "completed" : "pending"
                    }`}
                  />
                )}
              </div>

              <div className="step-content">
                <div className="step-row-top">
                  <span className="step-number">Stage 0{step.stepId}</span>
                  <span className="step-name">{step.name}</span>
                  <div className="step-meta">
                    {duration > 0 && (
                      <span className="step-duration">
                        {(duration / 1000).toFixed(2)}s
                      </span>
                    )}
                    {vramUsed > 0 && (
                      <span className="step-vram">
                        {(vramUsed / 1024).toFixed(1)} GB VRAM
                      </span>
                    )}
                  </div>
                </div>

                <p className="step-desc">{step.description}</p>

                {step.logDetail && (
                  <div className="step-log">
                    <code>{step.logDetail}</code>
                  </div>
                )}

                {step.outputPreview && (
                  <div className="step-preview-thumb">
                    <img
                      src={
                        step.outputPreview.startsWith("http")
                          ? step.outputPreview
                          : `http://localhost:5000${step.outputPreview}`
                      }
                      alt={`Stage ${step.stepId} Preview`}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

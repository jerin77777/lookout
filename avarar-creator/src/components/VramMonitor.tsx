import React from "react";
import { Cpu, HardDrive, CheckCircle2, AlertTriangle } from "lucide-react";
import type { GetVramStatusResponse } from "../services/arri_client.rpc";

interface VramMonitorProps {
  vramInfo: GetVramStatusResponse | null;
  peakVramMb?: number;
}

export const VramMonitor: React.FC<VramMonitorProps> = ({
  vramInfo,
  peakVramMb = 0,
}) => {
  const maxMb = vramInfo?.maxMb || 12288.0;
  const currentMb = vramInfo?.allocatedMb || 0;
  const targetBudgetMb = vramInfo?.targetBudgetMb || 9500.0;
  const percent = Math.min(100, Math.round((currentMb / maxMb) * 100));
  const peakPercent = Math.min(100, Math.round((peakVramMb / maxMb) * 100));

  const isSafe = currentMb < targetBudgetMb;

  return (
    <div className="vram-monitor-card">
      <div className="vram-header">
        <div className="vram-title">
          <Cpu className="icon-pulse" size={18} />
          <span>GPU VRAM Telemetry</span>
          <span className="gpu-badge">{vramInfo?.device || "NVIDIA RTX 3060 (12 GB)"}</span>
        </div>
        <div className={`vram-status-pill ${isSafe ? "safe" : "warning"}`}>
          {isSafe ? (
            <>
              <CheckCircle2 size={14} /> <span>12GB Budget Safe</span>
            </>
          ) : (
            <>
              <AlertTriangle size={14} /> <span>High VRAM Load</span>
            </>
          )}
        </div>
      </div>

      <div className="vram-stats-row">
        <div className="stat-item">
          <span className="stat-label">Active Allocated</span>
          <span className="stat-value">{(currentMb / 1024).toFixed(2)} GB</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Peak Pipeline VRAM</span>
          <span className="stat-value highlight">
            {(Math.max(peakVramMb, currentMb) / 1024).toFixed(2)} GB
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Safety Threshold</span>
          <span className="stat-value">{(targetBudgetMb / 1024).toFixed(1)} GB</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Hardware Total</span>
          <span className="stat-value">{(maxMb / 1024).toFixed(0)} GB</span>
        </div>
      </div>

      <div className="vram-progress-wrapper">
        <div className="vram-bar-track">
          <div
            className="vram-bar-fill"
            style={{
              width: `${percent}%`,
              backgroundColor:
                percent > 85 ? "#ef4444" : percent > 65 ? "#f59e0b" : "#10b981",
            }}
          />
          {peakPercent > 0 && (
            <div
              className="vram-peak-marker"
              style={{ left: `${peakPercent}%` }}
              title={`Peak VRAM: ${(peakVramMb / 1024).toFixed(2)} GB`}
            />
          )}
          <div
            className="vram-budget-line"
            style={{ left: `${(targetBudgetMb / maxMb) * 100}%` }}
            title="Safe budget boundary (9.5 GB)"
          />
        </div>
        <div className="vram-bar-labels">
          <span>0 GB</span>
          <span className="budget-label">Safe Budget (9.5 GB)</span>
          <span>12 GB Max</span>
        </div>
      </div>

      <div className="vram-tip">
        <HardDrive size={13} />
        <span>
          Sequential offloading active: FLUX 8-bit & Hunyuan3D unload weights between stages to keep VRAM &lt; 9.5 GB.
        </span>
      </div>
    </div>
  );
};


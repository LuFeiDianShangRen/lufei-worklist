import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { AlertOccurrence } from "../shared/types";
import "./overlay.css";

function Overlay(): JSX.Element {
  const [alert, setAlert] = useState<AlertOccurrence | null>(null);

  useEffect(() => window.reminderApi.onOverlayAlert(setAlert), []);

  if (!alert) {
    return <div className="overlay-stage" />;
  }

  return (
    <div className="overlay-stage">
      <span className="floating-alert">
        <span className="alert-copy">
          <span className="alert-title">{alert.title}</span>
          <span className="alert-detail">
            提前 {alert.leadMinutes} 分钟 · {new Date(alert.occurrenceAt).toLocaleString()}
          </span>
          {alert.description ? <span className="alert-description">{alert.description}</span> : null}
        </span>
        <button type="button" className="ack-button" onClick={() => window.reminderApi.acknowledgeOverlay(alert.key)}>
          知道了
        </button>
      </span>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("overlay-root")!).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>
);

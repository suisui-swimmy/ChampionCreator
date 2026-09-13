import { Button } from "./primitives";
import "./BulkMaximizeControls.css";

export function BulkMaximizeControls({ running, allowNatureChange, candidatesVisible = false, onRun, onCancel, onAllowNatureChange }: {
  running: boolean;
  allowNatureChange: boolean;
  candidatesVisible?: boolean;
  onRun: () => void;
  onCancel: () => void;
  onAllowNatureChange: (value: boolean) => void;
}) {
  return (
    <div className="sp-summary-actions">
      <div className="bulk-maximize-control-group" role="group" aria-label="残りSPで耐久最大化">
        <Button className="bulk-maximize-button" onClick={onRun} disabled={running} aria-expanded={candidatesVisible}>
          {running ? "計算中..." : "残りSPで耐久最大化"}
        </Button>
        <label className="bulk-nature-checkbox">
          <input type="checkbox" checked={allowNatureChange} onChange={(event) => onAllowNatureChange(event.target.checked)} />
          <span>性格変更</span>
        </label>
      </div>
      {running && <Button size="small" onClick={onCancel}>中止</Button>}
    </div>
  );
}

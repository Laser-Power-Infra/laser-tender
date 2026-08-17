import React from "react";

interface MultiSelectDropdownProps {
  selected: string[];
  options: string[];
  isOpen: boolean;
  onToggle: (value: string) => void;
  onClear: () => void;
  onSelectAll: () => void;
  onToggleOpen: () => void;
  panelId?: string;
}

export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  selected,
  options,
  isOpen,
  onToggle,
  onClear,
  onSelectAll,
  onToggleOpen,
  panelId,
}) => {
  return (
    <div className="custom-multiselect-container">
      <button
        className={`multiselect-trigger-btn${panelId ? " sidebar-filter-trigger" : ""}`}
        onClick={e => { e.stopPropagation(); onToggleOpen(); }}
        style={{ textTransform: "none", fontSize: 10 }}
      >
        {selected.length === 0 ? "Filter" : `${selected.length} Selected`}
        <span style={{ marginLeft: 4, fontSize: 9 }}>▼</span>
      </button>
      {isOpen && (
        <div
          id={panelId || undefined}
          className="multiselect-dropdown-panel dropdown-panel-open"
          style={{ minWidth: 220, maxHeight: 280, overflowY: "auto", zIndex: 9999 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="multiselect-actions">
            <button className="multiselect-action-btn" onClick={onClear}>Clear</button>
            <button className="multiselect-action-btn" onClick={onSelectAll}>All</button>
          </div>
          <div className="multiselect-options-list">
            {options.map(val => (
              <label key={val} className="multiselect-option-label">
                <input
                  type="checkbox"
                  checked={selected.includes(val)}
                  onChange={() => onToggle(val)}
                />
                <span>{val}</span>
              </label>
            ))}
            {options.length === 0 && (
              <span style={{ padding: 8, fontSize: 11, color: "#888" }}>No values</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiSelectDropdown;

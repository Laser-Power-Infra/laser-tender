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
  buttonLabel?: (count: number) => string;
  hasActive?: boolean;
  panelSearchValue?: string;
  onPanelSearchChange?: (v: string) => void;
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
  buttonLabel,
  hasActive,
  panelSearchValue,
  onPanelSearchChange,
}) => {
  const label = buttonLabel
    ? buttonLabel(selected.length)
    : selected.length === 0
      ? "Filter"
      : `${selected.length} Selected`;

  const q = panelSearchValue ? panelSearchValue.trim().toLowerCase() : "";
  const visibleOptions =
    q !== "" && onPanelSearchChange
      ? options.filter(o => o.toLowerCase().includes(q))
      : options;

  return (
    <div className="custom-multiselect-container">
      <button
        className={`multiselect-trigger-btn${panelId ? " sidebar-filter-trigger" : ""}${hasActive ? " multiselect-trigger-active" : ""}`}
        onClick={e => { e.stopPropagation(); onToggleOpen(); }}
        style={{ textTransform: "none", fontSize: 10 }}
      >
        {label}
        <span style={{ marginLeft: 4, fontSize: 9 }}>▼</span>
      </button>
      {isOpen && (
        <div
          id={panelId || undefined}
          className="multiselect-dropdown-panel dropdown-panel-open"
          style={{ minWidth: 220, maxHeight: 280, overflowY: "auto", zIndex: 9999 }}
          onClick={e => e.stopPropagation()}
        >
          {onPanelSearchChange && (
            <input
              type="text"
              className="multiselect-panel-search"
              placeholder="Type to filter..."
              value={panelSearchValue || ""}
              onChange={e => onPanelSearchChange(e.target.value)}
              autoFocus
            />
          )}
          <div className="multiselect-actions">
            <button className="multiselect-action-btn" onClick={onClear}>Clear</button>
            <button className="multiselect-action-btn" onClick={onSelectAll}>All</button>
          </div>
          <div className="multiselect-options-list">
            {visibleOptions.map(val => (
              <label key={val} className="multiselect-option-label">
                <input
                  type="checkbox"
                  checked={selected.includes(val)}
                  onChange={() => onToggle(val)}
                />
                <span>{val}</span>
              </label>
            ))}
            {visibleOptions.length === 0 && (
              <span style={{ padding: 8, fontSize: 11, color: "#888" }}>No values</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiSelectDropdown;

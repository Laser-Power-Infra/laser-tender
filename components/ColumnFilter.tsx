import React from "react";
import MultiSelectDropdown from "./MultiSelectDropdown";

interface ColumnFilterProps {
  searchValue: string;
  onSearchChange: (v: string) => void;
  selected: string[];
  options: string[];
  isOpen: boolean;
  onToggleOpen: () => void;
  onToggle: (value: string) => void;
  onClear: () => void;
  onSelectAll: () => void;
  placeholder?: string;
  buttonLabel?: (count: number) => string;
  panelId?: string;
  hasActiveFilter?: boolean;
  panelSearchValue?: string;
  onPanelSearchChange?: (v: string) => void;
}

export const ColumnFilter: React.FC<ColumnFilterProps> = ({
  searchValue,
  onSearchChange,
  selected,
  options,
  isOpen,
  onToggleOpen,
  onToggle,
  onClear,
  onSelectAll,
  placeholder,
  buttonLabel,
  panelId,
  hasActiveFilter,
  panelSearchValue,
  onPanelSearchChange,
}) => {
  const active = hasActiveFilter ?? (searchValue.trim() !== "" || selected.length > 0);
  return (
    <div
      className="column-filter-box"
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="column-filter-row">
        <input
          type="text"
          className="column-search-input"
          placeholder={placeholder || "Search..."}
          value={searchValue}
          style={searchValue !== "" ? { paddingRight: 22 } : undefined}
          onChange={e => onSearchChange(e.target.value)}
        />
        {searchValue !== "" && (
          <button
            className="col-filter-clear-btn"
            onClick={() => onSearchChange("")}
            title="Clear search"
          >
            ✕
          </button>
        )}
      </div>
      <MultiSelectDropdown
        selected={selected}
        options={options}
        isOpen={isOpen}
        onToggle={onToggle}
        onClear={onClear}
        onSelectAll={onSelectAll}
        onToggleOpen={onToggleOpen}
        panelId={panelId}
        buttonLabel={buttonLabel}
        hasActive={active}
        panelSearchValue={panelSearchValue}
        onPanelSearchChange={onPanelSearchChange}
      />
    </div>
  );
};

export default ColumnFilter;

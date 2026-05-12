export function SidebarReorder({ reorderMode, hint, onEnter, onCancel, onApply }) {
  return (
    <nav className="sidebar-reorder-toolbar" id="sidebarReorderToolbar" aria-label="Reorder sidebar cards">
      <div className="sidebar-reorder-toolbar-row sidebar-reorder-toolbar-row--actions" id="sidebarReorderToolbarRow2">
        <button type="button" id="sidebarReorderModeBtn" title="Reorder sidebar cards" hidden={reorderMode} onClick={onEnter}>
          <svg className="sidebar-reorder-btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          <span>Reorder</span>
        </button>
        <p className="sidebar-reorder-toolbar-hint" id="sidebarReorderHint" hidden={!reorderMode}>
          {hint}
        </p>
        <button type="button" id="sidebarReorderCancel" hidden={!reorderMode} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="sidebar-reorder-apply" id="sidebarReorderApply" hidden={!reorderMode} onClick={onApply}>
          Apply
        </button>
      </div>
    </nav>
  );
}

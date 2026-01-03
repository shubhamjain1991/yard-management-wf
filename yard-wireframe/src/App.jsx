import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Yard + Slot Management (Wireframe)
 * - Uses localStorage to persist:
 *   - inbound containers
 *   - yard layout (slot -> stack of container IDs)
 *   - container master data
 *   - previous slot signatures (to detect rearrangement)
 *
 * Features:
 * - "Poll" simulation adds random inbound containers to DB
 * - "Auto-place" puts inbound containers into first available slot (or stack limit)
 * - Manual move: select container -> move to another slot -> optional reorder inside slot
 * - Highlights slots whose container arrangement changed since last signature snapshot
 */

const LS_KEYS = {
  CONTAINERS: "yard.containers.v1", // { [id]: container }
  INBOUND: "yard.inbound.v1", // [id]
  LAYOUT: "yard.layout.v1", // { [slotId]: [containerId, ...] }
  PREV_SIG: "yard.prevSig.v1", // { [slotId]: "id1|id2|..." }
};

const DEFAULT_CONFIG = {
  zones: ["A", "B", "C"],
  rowsPerZone: 4,
  colsPerZone: 6,
  stackLimit: 2, // max containers per slot (wireframe)
};

function nowISO() {
  return new Date().toISOString();
}

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function loadLS(key, fallback) {
  return safeParse(localStorage.getItem(key), fallback);
}
function saveLS(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function randomId(prefix = "CONT") {
  const n = Math.floor(Math.random() * 900000) + 100000;
  return `${prefix}-${n}`;
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildSlotId(zone, r, c) {
  // 1-indexed for human readability
  return `${zone}-R${String(r).padStart(2, "0")}-C${String(c).padStart(2, "0")}`;
}

function slotSignature(stack) {
  // IMPORTANT: Order matters; any reorder triggers highlight
  return (stack || []).join("|");
}

function makeContainer(id) {
  const sizes = ["20FT", "40FT"];
  const types = ["DRY", "REEFER", "OPEN"];
  const priorities = ["NORMAL", "HIGH"];
  return {
    id,
    size: randomFrom(sizes),
    type: randomFrom(types),
    priority: Math.random() < 0.2 ? "HIGH" : randomFrom(priorities),
    status: "INBOUND",
    createdAt: nowISO(),
  };
}

function computeChangedSlots(layout, prevSigMap) {
  const changed = new Set();
  for (const [slotId, stack] of Object.entries(layout)) {
    const sig = slotSignature(stack);
    const prev = prevSigMap?.[slotId] ?? "";
    if (sig !== prev) changed.add(slotId);
  }
  // Also: if a slot existed in prev but now missing (cleared), mark as changed
  for (const slotId of Object.keys(prevSigMap || {})) {
    if (!(slotId in layout)) {
      changed.add(slotId);
    }
  }
  return changed;
}

export default function YardSlotWireframe() {
  const config = DEFAULT_CONFIG;

  const allSlots = useMemo(() => {
    const slots = [];
    for (const z of config.zones) {
      for (let r = 1; r <= config.rowsPerZone; r++) {
        for (let c = 1; c <= config.colsPerZone; c++) {
          slots.push(buildSlotId(z, r, c));
        }
      }
    }
    return slots;
  }, []);

  const [containers, setContainers] = useState(() => loadLS(LS_KEYS.CONTAINERS, {}));
  const [inboundIds, setInboundIds] = useState(() => loadLS(LS_KEYS.INBOUND, []));
  const [layout, setLayout] = useState(() => {
    const l = loadLS(LS_KEYS.LAYOUT, {});
    // Ensure every slot exists
    const normalized = {};
    for (const s of allSlots) normalized[s] = Array.isArray(l[s]) ? l[s] : [];
    return normalized;
  });
  const [prevSig, setPrevSig] = useState(() => loadLS(LS_KEYS.PREV_SIG, {}));

  const [selectedContainerId, setSelectedContainerId] = useState(null);
  const [selectedSlotId, setSelectedSlotId] = useState(null);

  // Recompute changed slots live
  const changedSlots = useMemo(() => computeChangedSlots(layout, prevSig), [layout, prevSig]);

  // Persist to localStorage
  useEffect(() => saveLS(LS_KEYS.CONTAINERS, containers), [containers]);
  useEffect(() => saveLS(LS_KEYS.INBOUND, inboundIds), [inboundIds]);
  useEffect(() => saveLS(LS_KEYS.LAYOUT, layout), [layout]);
  useEffect(() => saveLS(LS_KEYS.PREV_SIG, prevSig), [prevSig]);

  // Helpers
  function resetAll() {
    localStorage.removeItem(LS_KEYS.CONTAINERS);
    localStorage.removeItem(LS_KEYS.INBOUND);
    localStorage.removeItem(LS_KEYS.LAYOUT);
    localStorage.removeItem(LS_KEYS.PREV_SIG);
    setContainers({});
    setInboundIds([]);
    const empty = {};
    for (const s of allSlots) empty[s] = [];
    setLayout(empty);
    setPrevSig({});
    setSelectedContainerId(null);
    setSelectedSlotId(null);
  }

  function pollInbound(count = 5) {
    // Simulate a poll response populating DB with containers
    const newContainers = { ...containers };
    const newInbound = [...inboundIds];

    for (let i = 0; i < count; i++) {
      let id = randomId("CONT");
      while (newContainers[id]) id = randomId("CONT");
      newContainers[id] = makeContainer(id);
      newInbound.unshift(id); // newest first
    }

    setContainers(newContainers);
    setInboundIds(newInbound);
  }

  function firstAvailableSlot() {
    for (const s of allSlots) {
      if ((layout[s] || []).length < config.stackLimit) return s;
    }
    return null;
  }

  function autoPlace(n = 10) {
    // Place up to n inbound containers into first available slot
    const newLayout = { ...layout };
    const newContainers = { ...containers };
    const newInbound = [...inboundIds];

    let placed = 0;
    while (newInbound.length > 0 && placed < n) {
      const slot = firstAvailableSlot();
      if (!slot) break;

      const cid = newInbound.pop(); // place oldest first
      const stack = [...(newLayout[slot] || [])];
      stack.push(cid);
      newLayout[slot] = stack;

      newContainers[cid] = { ...newContainers[cid], status: "IN_YARD", placedAt: nowISO(), slotId: slot };
      placed++;
    }

    setLayout(newLayout);
    setContainers(newContainers);
    setInboundIds(newInbound);
  }

  function moveSelectedToSlot(targetSlotId) {
    if (!selectedContainerId) return;

    const cid = selectedContainerId;
    const newLayout = { ...layout };

    // Remove cid from wherever it is
    for (const s of Object.keys(newLayout)) {
      if (newLayout[s]?.includes(cid)) {
        newLayout[s] = newLayout[s].filter((x) => x !== cid);
      }
    }

    // If it was inbound, remove from inbound list
    const newInbound = inboundIds.filter((x) => x !== cid);

    // Add to target slot if space
    const stack = [...(newLayout[targetSlotId] || [])];
    if (stack.length >= config.stackLimit) {
      alert(`Slot ${targetSlotId} is full (stack limit ${config.stackLimit}).`);
      return;
    }
    stack.push(cid);
    newLayout[targetSlotId] = stack;

    // Update container status
    const newContainers = { ...containers };
    newContainers[cid] = { ...(newContainers[cid] || { id: cid }), status: "IN_YARD", movedAt: nowISO(), slotId: targetSlotId };

    setLayout(newLayout);
    setInboundIds(newInbound);
    setContainers(newContainers);
  }

  function reorderWithinSlot(slotId, fromIndex, toIndex) {
    const stack = [...(layout[slotId] || [])];
    if (fromIndex < 0 || fromIndex >= stack.length) return;
    if (toIndex < 0 || toIndex >= stack.length) return;
    const [item] = stack.splice(fromIndex, 1);
    stack.splice(toIndex, 0, item);
    setLayout({ ...layout, [slotId]: stack });
  }

  function removeFromSlot(slotId, cid) {
    const newLayout = { ...layout, [slotId]: (layout[slotId] || []).filter((x) => x !== cid) };
    // Put it back inbound (simulate gate-out / rework)
    const newInbound = [cid, ...inboundIds.filter((x) => x !== cid)];
    const newContainers = { ...containers, [cid]: { ...containers[cid], status: "INBOUND", slotId: null, updatedAt: nowISO() } };
    setLayout(newLayout);
    setInboundIds(newInbound);
    setContainers(newContainers);
  }

  function snapshotSignatures() {
    // "Acknowledge": set prevSig to current signatures, clearing highlights
    const next = {};
    for (const s of allSlots) {
      next[s] = slotSignature(layout[s] || []);
    }
    setPrevSig(next);
  }

  // KPIs
  const inboundCount = inboundIds.length;
  const inYardCount = Object.values(layout).reduce((acc, st) => acc + (st?.length || 0), 0);
  const capacity = allSlots.length * config.stackLimit;
  const utilizationPct = capacity ? Math.round((inYardCount / capacity) * 100) : 0;

  // UI styling
  const styles = {
    page: { fontFamily: "system-ui, Segoe UI, Roboto, Arial", padding: 16, background: "#0b1220", color: "#e7eefc", minHeight: "100vh" },
    header: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 },
    pill: { padding: "6px 10px", borderRadius: 999, background: "#16223c", border: "1px solid #22355f", fontSize: 12 },
    button: {
      padding: "8px 10px",
      borderRadius: 10,
      background: "#1a2b52",
      border: "1px solid #2a3f73",
      color: "#e7eefc",
      cursor: "pointer",
    },
    buttonDanger: { background: "#3a1420", border: "1px solid #7b2a3f" },
    gridWrap: { display: "grid", gridTemplateColumns: "360px 1fr", gap: 12, alignItems: "start" },
    card: { background: "#0f1a33", border: "1px solid #22355f", borderRadius: 16, padding: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.25)" },
    title: { fontSize: 14, fontWeight: 700, marginBottom: 8, opacity: 0.95 },
    small: { fontSize: 12, opacity: 0.8 },
    inboundList: { display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflow: "auto", paddingRight: 6 },
    inboundItem: (active) => ({
      padding: 10,
      borderRadius: 12,
      border: active ? "1px solid #86a8ff" : "1px solid #22355f",
      background: active ? "rgba(134,168,255,0.12)" : "#0b1430",
      cursor: "pointer",
    }),
    yard: { display: "flex", flexDirection: "column", gap: 12 },
    zoneRow: { display: "flex", gap: 12, alignItems: "start" },
    zoneLabel: { width: 26, textAlign: "center", fontWeight: 800, opacity: 0.9, paddingTop: 8 },
    zoneGrid: { display: "grid", gap: 8, gridTemplateColumns: `repeat(${config.colsPerZone}, minmax(110px, 1fr))` },
    slot: (isSelected, isChanged) => ({
      borderRadius: 14,
      padding: 10,
      border: isSelected ? "1px solid #86a8ff" : "1px solid #22355f",
      background: "#0b1430",
      position: "relative",
      outline: isChanged ? "2px solid #ffd166" : "none",
      boxShadow: isChanged ? "0 0 0 3px rgba(255,209,102,0.18)" : "none",
      transition: "box-shadow 150ms ease, outline 150ms ease",
      cursor: "pointer",
      minHeight: 92,
    }),
    slotTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
    slotId: { fontSize: 11, opacity: 0.9, fontWeight: 700 },
    badge: { fontSize: 10, padding: "2px 8px", borderRadius: 999, border: "1px solid #22355f", background: "#0f1a33", opacity: 0.95 },
    stack: { display: "flex", flexDirection: "column", gap: 6 },
    chip: (active) => ({
      display: "flex",
      justifyContent: "space-between",
      gap: 8,
      alignItems: "center",
      padding: "6px 8px",
      borderRadius: 10,
      border: active ? "1px solid #86a8ff" : "1px solid #22355f",
      background: active ? "rgba(134,168,255,0.10)" : "#0f1a33",
      fontSize: 11,
      cursor: "pointer",
    }),
    chipRight: { display: "flex", gap: 6, alignItems: "center" },
    linkBtn: {
      fontSize: 10,
      padding: "3px 6px",
      borderRadius: 8,
      border: "1px solid #22355f",
      background: "#0b1430",
      color: "#e7eefc",
      cursor: "pointer",
    },
    changedTag: {
      position: "absolute",
      top: 8,
      right: 8,
      fontSize: 10,
      padding: "2px 8px",
      borderRadius: 999,
      background: "rgba(255,209,102,0.16)",
      border: "1px solid rgba(255,209,102,0.50)",
      color: "#ffd166",
      fontWeight: 800,
    },
    hint: { fontSize: 12, opacity: 0.8, marginTop: 10, lineHeight: 1.35 },
  };

  const selectedContainer = selectedContainerId ? containers[selectedContainerId] : null;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>Yard & Slot Management — Interactive Wireframe</div>
        <div style={styles.pill}>Inbound: <b>{inboundCount}</b></div>
        <div style={styles.pill}>In Yard: <b>{inYardCount}</b> / {capacity} ({utilizationPct}%)</div>
        <div style={styles.pill}>Changed Slots: <b>{changedSlots.size}</b></div>

        <button style={styles.button} onClick={() => pollInbound(5)}>Poll +5 Containers</button>
        <button style={styles.button} onClick={() => autoPlace(10)}>Auto-place (up to 10)</button>
        <button style={styles.button} onClick={snapshotSignatures}>Acknowledge changes</button>
        <button style={{ ...styles.button, ...styles.buttonDanger }} onClick={resetAll}>Reset local data</button>
      </div>

      <div style={styles.gridWrap}>
        {/* LEFT PANEL */}
        <div style={styles.card}>
          <div style={styles.title}>Inbound Queue (DB)</div>
          <div style={styles.small}>
            Click a container to select it. Then click any slot to place/move it.  
            Reordering inside slot will also trigger “rearranged” highlight.
          </div>

          <div style={{ marginTop: 10, marginBottom: 10, padding: 10, borderRadius: 12, border: "1px solid #22355f", background: "#0b1430" }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              <b>Selected:</b>{" "}
              {selectedContainerId ? (
                <span>
                  {selectedContainerId}{" "}
                  <span style={{ opacity: 0.75 }}>
                    ({selectedContainer?.size}/{selectedContainer?.type}, {selectedContainer?.priority})
                  </span>
                </span>
              ) : (
                <span style={{ opacity: 0.65 }}>None</span>
              )}
            </div>
          </div>

          <div style={styles.inboundList}>
            {inboundIds.length === 0 ? (
              <div style={styles.small}>No inbound containers. Click “Poll” to simulate arrival data.</div>
            ) : (
              inboundIds.map((cid) => {
                const c = containers[cid];
                const active = cid === selectedContainerId;
                return (
                  <div
                    key={cid}
                    style={styles.inboundItem(active)}
                    onClick={() => setSelectedContainerId(cid)}
                    title="Select to place/move"
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 800, fontSize: 12 }}>{cid}</div>
                      <div style={{ fontSize: 11, opacity: 0.85 }}>{c?.size} • {c?.type}</div>
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
                      Priority: <b>{c?.priority}</b> • Status: <b>{c?.status}</b>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={styles.hint}>
            <b>Note (highlight rule):</b> a slot is highlighted if its container stack (IDs + order) differs from the last acknowledged snapshot.
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div style={styles.yard}>
          <div style={styles.card}>
            <div style={styles.title}>Yard View (Zones → Slots)</div>
            <div style={styles.small}>
              Stack limit per slot: <b>{config.stackLimit}</b>. Click slot to place the selected container.
            </div>
          </div>

          {config.zones.map((zone) => {
            const zoneSlots = allSlots.filter((s) => s.startsWith(zone + "-"));
            // create rows
            const rows = [];
            for (let r = 1; r <= config.rowsPerZone; r++) {
              const rowSlots = [];
              for (let c = 1; c <= config.colsPerZone; c++) rowSlots.push(buildSlotId(zone, r, c));
              rows.push(rowSlots);
            }

            return (
              <div key={zone} style={styles.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={styles.title}>Zone {zone}</div>
                  <div style={styles.small}>
                    Slots: <b>{zoneSlots.length}</b>
                  </div>
                </div>

                {rows.map((rowSlots, idx) => (
                  <div key={idx} style={styles.zoneRow}>
                    <div style={styles.zoneLabel}>R{String(idx + 1).padStart(2, "0")}</div>
                    <div style={styles.zoneGrid}>
                      {rowSlots.map((slotId) => {
                        const stack = layout[slotId] || [];
                        const isSelected = slotId === selectedSlotId;
                        const isChanged = changedSlots.has(slotId);
                        return (
                          <div
                            key={slotId}
                            style={styles.slot(isSelected, isChanged)}
                            onClick={() => {
                              setSelectedSlotId(slotId);
                              if (selectedContainerId) moveSelectedToSlot(slotId);
                            }}
                            title="Click to place/move selected container here"
                          >
                            {isChanged && <div style={styles.changedTag}>REARRANGED</div>}

                            <div style={styles.slotTop}>
                              <div style={styles.slotId}>{slotId}</div>
                              <div style={styles.badge}>
                                {stack.length}/{config.stackLimit}
                              </div>
                            </div>

                            <div style={styles.stack}>
                              {stack.length === 0 ? (
                                <div style={{ fontSize: 11, opacity: 0.65 }}>Empty</div>
                              ) : (
                                stack.map((cid, i) => {
                                  const active = cid === selectedContainerId;
                                  const c = containers[cid];
                                  return (
                                    <div
                                      key={cid}
                                      style={styles.chip(active)}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedContainerId(cid);
                                      }}
                                      title="Click to select this container"
                                    >
                                      <div style={{ fontWeight: 800 }}>{cid}</div>
                                      <div style={styles.chipRight}>
                                        <span style={{ opacity: 0.85 }}>{c?.size}</span>
                                        <button
                                          style={styles.linkBtn}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (i > 0) reorderWithinSlot(slotId, i, i - 1);
                                          }}
                                          title="Move up"
                                        >
                                          ↑
                                        </button>
                                        <button
                                          style={styles.linkBtn}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (i < stack.length - 1) reorderWithinSlot(slotId, i, i + 1);
                                          }}
                                          title="Move down"
                                        >
                                          ↓
                                        </button>
                                        <button
                                          style={styles.linkBtn}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeFromSlot(slotId, cid);
                                          }}
                                          title="Send back to inbound"
                                        >
                                          ↩
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          <div style={styles.card}>
            <div style={styles.title}>Simulation Notes (wireframe)</div>
            <div style={styles.small} style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.45 }}>
              <ul>
                <li><b>Poll</b> simulates DB filling via a periodic request.</li>
                <li><b>Placement</b> is stubbed (first available slot). You can replace logic with your app’s placement rules.</li>
                <li><b>Rearranged highlight</b> triggers on any slot stack change: add, remove, move, reorder.</li>
                <li>Use <b>Acknowledge changes</b> to snapshot the current arrangement as the new baseline.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

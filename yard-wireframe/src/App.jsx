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
  const owners = ["A. Singh", "R. Patel", "M. Chen", "K. Gomez", "S. Williams", "N. Okafor"];
  const companies = ["BlueWave Logistics", "HarborLine", "Nova Freight", "Atlas Shipping", "Summit Trade"];
  const materials = ["Steel Coils", "Apparel", "Electronics", "Food Grade", "Auto Parts", "Building Materials"];
  const moveIn = new Date(Date.now() - Math.floor(Math.random() * 6) * 24 * 60 * 60 * 1000);
  const moveOut = new Date(moveIn.getTime() + (Math.floor(Math.random() * 6) + 2) * 24 * 60 * 60 * 1000);
  return {
    id,
    size: randomFrom(sizes),
    type: randomFrom(types),
    priority: Math.random() < 0.2 ? "HIGH" : randomFrom(priorities),
    status: "INBOUND",
    createdAt: nowISO(),
    ownerName: randomFrom(owners),
    companyName: randomFrom(companies),
    material: randomFrom(materials),
    moveInDate: moveIn.toISOString(),
    moveOutDate: moveOut.toISOString(),
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
  const [selectedZone, setSelectedZone] = useState(DEFAULT_CONFIG.zones[0]);
  const [selectedBay, setSelectedBay] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchType, setSearchType] = useState("owner");
  const [searchValue, setSearchValue] = useState("");

  // Recompute changed slots live
  const changedSlots = useMemo(() => computeChangedSlots(layout, prevSig), [layout, prevSig]);

  // Persist to localStorage
  useEffect(() => saveLS(LS_KEYS.CONTAINERS, containers), [containers]);
  useEffect(() => saveLS(LS_KEYS.INBOUND, inboundIds), [inboundIds]);
  useEffect(() => saveLS(LS_KEYS.LAYOUT, layout), [layout]);
  useEffect(() => saveLS(LS_KEYS.PREV_SIG, prevSig), [prevSig]);

  useEffect(() => {
    if (selectedContainerId) return;
    const inboundFirst = inboundIds[0];
    const containerIds = Object.keys(containers);
    const fallback = containerIds.length ? containerIds[0] : null;
    const next = inboundFirst || fallback;
    if (next) setSelectedContainerId(next);
  }, [containers, inboundIds, selectedContainerId]);

  useEffect(() => {
    const hasData =
      Object.keys(containers).length > 0 ||
      inboundIds.length > 0 ||
      Object.values(layout).some((stack) => stack.length > 0);
    if (hasData) return;

    const seededContainers = {};
    const seededInbound = [];
    const seededLayout = {};
    for (const slot of allSlots) seededLayout[slot] = [];

    const total = 12;
    for (let i = 0; i < total; i++) {
      let id = randomId("CONT");
      while (seededContainers[id]) id = randomId("CONT");
      seededContainers[id] = makeContainer(id);
      seededInbound.unshift(id);
    }

    const slotsIterator = allSlots[Symbol.iterator]();
    let nextSlot = slotsIterator.next();
    while (seededInbound.length > 0 && !nextSlot.done) {
      const slotId = nextSlot.value;
      const stack = seededLayout[slotId];
      while (stack.length < config.stackLimit && seededInbound.length > 0) {
        const cid = seededInbound.pop();
        stack.push(cid);
        seededContainers[cid] = {
          ...seededContainers[cid],
          status: "IN_YARD",
          placedAt: nowISO(),
          slotId,
        };
      }
      nextSlot = slotsIterator.next();
    }

    setContainers(seededContainers);
    setInboundIds(seededInbound);
    setLayout(seededLayout);
  }, []);

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

  function selectContainerFromSearch(container) {
    if (!container) return;
    setSelectedContainerId(container.id);
    if (container.slotId) {
      setSelectedSlotId(container.slotId);
      const [zone, rowPart] = container.slotId.split("-");
      const rowNumber = Number(rowPart?.replace("R", ""));
      if (zone) setSelectedZone(zone);
      if (rowNumber) setSelectedBay(rowNumber);
    }
    setSearchOpen(false);
  }

  // KPIs
  const inboundCount = inboundIds.length;
  const inYardCount = Object.values(layout).reduce((acc, st) => acc + (st?.length || 0), 0);
  const capacity = allSlots.length * config.stackLimit;
  const utilizationPct = capacity ? Math.round((inYardCount / capacity) * 100) : 0;
  const zoneAvailability = config.zones.map((zone) => {
    const zoneSlots = allSlots.filter((slot) => slot.startsWith(`${zone}-`));
    const used = zoneSlots.reduce((acc, slot) => acc + (layout[slot]?.length || 0), 0);
    const total = zoneSlots.length * config.stackLimit;
    return { zone, remaining: total - used, total };
  });
  const baySlots = useMemo(() => {
    const rowLabel = `R${String(selectedBay).padStart(2, "0")}`;
    return allSlots.filter((slot) => slot.startsWith(`${selectedZone}-${rowLabel}`));
  }, [allSlots, selectedZone, selectedBay]);

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
  }

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
    gridWrap: { display: "grid", gridTemplateColumns: "340px 320px 1fr", gap: 12, alignItems: "start" },
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
    splitCol: { display: "grid", gridTemplateRows: "1fr 4fr", gap: 12, alignItems: "start" },
    searchOverlay: {
      position: "fixed",
      inset: 0,
      background: "rgba(6,10,20,0.72)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 50,
      padding: 16,
    },
    searchModal: {
      width: "min(720px, 96vw)",
      background: "#0f1a33",
      borderRadius: 16,
      border: "1px solid #22355f",
      padding: 16,
      boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
    },
    searchRow: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 },
    input: {
      flex: 1,
      minWidth: 220,
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid #22355f",
      background: "#0b1430",
      color: "#e7eefc",
    },
    select: {
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid #22355f",
      background: "#0b1430",
      color: "#e7eefc",
    },
    tableWrap: { marginTop: 12, overflowX: "auto" },
    table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
    th: { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #22355f", fontWeight: 700, whiteSpace: "nowrap" },
    td: { padding: "8px 10px", borderBottom: "1px solid #16223c", whiteSpace: "nowrap" },
    rowButton: {
      padding: "4px 8px",
      borderRadius: 8,
      border: "1px solid #22355f",
      background: "#0b1430",
      color: "#e7eefc",
      cursor: "pointer",
      fontSize: 10,
    },
    resultItem: {
      padding: 10,
      borderRadius: 12,
      border: "1px solid #22355f",
      background: "#0b1430",
      cursor: "pointer",
    },
  };

  const selectedContainer = selectedContainerId ? containers[selectedContainerId] : null;
  const searchOptions = useMemo(() => {
    const values = new Set();
    for (const container of Object.values(containers)) {
      if (searchType === "container" && container.id) values.add(container.id);
      if (searchType === "company" && container.companyName) values.add(container.companyName);
      if (searchType === "owner" && container.ownerName) values.add(container.ownerName);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [containers, searchType]);

  useEffect(() => {
    if (!searchOpen) return;
    if (!searchOptions.length) {
      setSearchValue("");
      return;
    }
    if (!searchOptions.includes(searchValue)) {
      setSearchValue(searchOptions[0]);
    }
  }, [searchOpen, searchOptions, searchValue]);

  const searchValueNormalized = searchValue.trim().toLowerCase();
  const searchResults = Object.values(containers).filter((container) => {
    if (!searchValueNormalized) return false;
    if (searchType === "container") return container.id.toLowerCase() === searchValueNormalized;
    if (searchType === "company") return container.companyName?.toLowerCase() === searchValueNormalized;
    return container.ownerName?.toLowerCase() === searchValueNormalized;
  });

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>Yard & Slot Management — Interactive Wireframe</div>
        <div style={styles.pill}>Inbound: <b>{inboundCount}</b></div>
        <div style={styles.pill}>In Yard: <b>{inYardCount}</b> / {capacity} ({utilizationPct}%)</div>
        <div style={styles.pill}>Changed Slots: <b>{changedSlots.size}</b></div>

        <button style={styles.button} onClick={() => setSearchOpen(true)}>Search Containers</button>
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

        {/* MIDDLE PANEL */}
        <div style={styles.card}>
          <div style={styles.title}>Selected Container Information</div>
          {selectedContainer ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={styles.pill}><b>{selectedContainer.id}</b> • {selectedContainer.size} • {selectedContainer.type}</div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={styles.small}><b>Owner:</b> {selectedContainer.ownerName || "—"}</div>
                <div style={styles.small}><b>Company:</b> {selectedContainer.companyName || "—"}</div>
                <div style={styles.small}><b>Material:</b> {selectedContainer.material || "—"}</div>
                <div style={styles.small}><b>Move-in:</b> {formatDate(selectedContainer.moveInDate)}</div>
                <div style={styles.small}><b>Move-out:</b> {formatDate(selectedContainer.moveOutDate)}</div>
                <div style={styles.small}><b>Status:</b> {selectedContainer.status}</div>
                <div style={styles.small}><b>Slot:</b> {selectedContainer.slotId || "Inbound"}</div>
              </div>
            </div>
          ) : (
            <div style={styles.small}>Select a container from the list or the yard to view details.</div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div style={styles.splitCol}>
          <div style={styles.card}>
            <div style={styles.title}>Availability by Zone</div>
            <div style={{ display: "grid", gap: 8 }}>
              {zoneAvailability.map((zone) => (
                <div key={zone.zone} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={styles.small}>Zone {zone.zone}</div>
                  <div style={styles.badge}>
                    {zone.remaining} / {zone.total} available
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={styles.title}>Yard / Slot Management</div>
              <div style={styles.small}>
                Stack limit: <b>{config.stackLimit}</b>
              </div>
            </div>

            <div style={styles.searchRow}>
              <label style={styles.small}>Zone</label>
              <select
                style={styles.select}
                value={selectedZone}
                onChange={(e) => {
                  setSelectedZone(e.target.value);
                  setSelectedBay(1);
                }}
              >
                {config.zones.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
              <label style={styles.small}>Bay</label>
              <select
                style={styles.select}
                value={selectedBay}
                onChange={(e) => setSelectedBay(Number(e.target.value))}
              >
                {Array.from({ length: config.rowsPerZone }, (_, idx) => idx + 1).map((bay) => (
                  <option key={bay} value={bay}>R{String(bay).padStart(2, "0")}</option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={styles.small}>Virtual rack — click a slot to place the selected container.</div>
              <div style={{ display: "grid", gap: 8, marginTop: 10, gridTemplateColumns: `repeat(${config.colsPerZone}, minmax(120px, 1fr))` }}>
                {baySlots.map((slotId) => {
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
          </div>
        </div>
      </div>

      {searchOpen && (
        <div style={styles.searchOverlay} onClick={() => setSearchOpen(false)}>
          <div style={styles.searchModal} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={styles.title}>Search Containers</div>
              <button style={styles.button} onClick={() => setSearchOpen(false)}>Close</button>
            </div>
            <div style={styles.searchRow}>
              <select style={styles.select} value={searchType} onChange={(e) => setSearchType(e.target.value)}>
                <option value="owner">Owner Name</option>
                <option value="company">Company Name</option>
                <option value="container">Container Number</option>
              </select>
              <select
                style={styles.select}
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
              >
                {searchOptions.length === 0 ? (
                  <option value="">No options available</option>
                ) : (
                  searchOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {!searchValue && <div style={styles.small}>Select a search value to view results.</div>}
              {searchValue && searchResults.length === 0 && (
                <div style={styles.small}>No containers match that search.</div>
              )}
              {searchValue && searchType === "container" && searchResults[0] && (
                <div style={styles.resultItem}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 800 }}>{searchResults[0].id}</div>
                    <div style={{ fontSize: 11, opacity: 0.8 }}>
                      {searchResults[0].slotId ? `Slot ${searchResults[0].slotId}` : "Inbound"}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                    Owner: <b>{searchResults[0].ownerName}</b> • Company: <b>{searchResults[0].companyName}</b>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
                    Material: <b>{searchResults[0].material}</b> • Status: <b>{searchResults[0].status}</b>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
                    Check-in: <b>{formatDate(searchResults[0].moveInDate)}</b> • Check-out:{" "}
                    <b>{formatDate(searchResults[0].moveOutDate)}</b>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <button style={styles.rowButton} onClick={() => selectContainerFromSearch(searchResults[0])}>
                      Focus container
                    </button>
                  </div>
                </div>
              )}
              {searchValue && searchType !== "container" && searchResults.length > 0 && (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Container ID</th>
                        <th style={styles.th}>Owner</th>
                        <th style={styles.th}>Company</th>
                        <th style={styles.th}>Material</th>
                        <th style={styles.th}>Type</th>
                        <th style={styles.th}>Size</th>
                        <th style={styles.th}>Check-in</th>
                        <th style={styles.th}>Check-out</th>
                        <th style={styles.th}>Status</th>
                        <th style={styles.th}>Slot</th>
                        <th style={styles.th}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchResults.map((container) => (
                        <tr key={container.id}>
                          <td style={styles.td}>{container.id}</td>
                          <td style={styles.td}>{container.ownerName}</td>
                          <td style={styles.td}>{container.companyName}</td>
                          <td style={styles.td}>{container.material}</td>
                          <td style={styles.td}>{container.type}</td>
                          <td style={styles.td}>{container.size}</td>
                          <td style={styles.td}>{formatDate(container.moveInDate)}</td>
                          <td style={styles.td}>{formatDate(container.moveOutDate)}</td>
                          <td style={styles.td}>{container.status}</td>
                          <td style={styles.td}>{container.slotId || "Inbound"}</td>
                          <td style={styles.td}>
                            <button style={styles.rowButton} onClick={() => selectContainerFromSearch(container)}>
                              Focus
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {searchType === "container" && searchResults.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
                Container metadata is shown above. Use “Focus container” to jump to its slot.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

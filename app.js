// ==========================================================================
// time.fajr.work — Application Logic
// ==========================================================================

(function () {
  "use strict";

  const STORAGE_KEY = "fajr_time_planner_v1";
  const MAX_RECOMMENDED_LOCATIONS = 5;

  // Initial State matching the screenshot exactly
  const DEFAULT_STATE = {
    use12Hour: false,
    referenceIndex: 0,
    locations: [
      {
        city: "London",
        country: "United Kingdom",
        timezone: "Europe/London",
        workStart: 8,  // 08:00 AM
        workEnd: 18    // 06:00 PM
      },
      {
        city: "Los Angeles",
        country: "United States",
        timezone: "America/Los_Angeles",
        workStart: 8,  // 08:00 AM
        workEnd: 18    // 06:00 PM
      },
      {
        city: "Hong Kong",
        country: "Hong Kong SAR",
        timezone: "Asia/Hong_Kong",
        workStart: 8,  // 08:00 AM
        workEnd: 24    // 12:00 AM (midnight)
      }
    ]
  };

  let state = loadState();

  // Selected timeline slot (0 to 47).
  // Slot 4 corresponds to anchor reference time (e.g. 15:00 in London)
  let selectedSlotIndex = 4;
  let timelineBaseDate = null;
  let isDraggingScrubber = false;
  let liveTimerInterval = null;

  // DOM Elements
  const dayMainHeading = document.getElementById("day-main-heading");
  const locationsCounter = document.getElementById("locations-counter");
  const locationCardsGrid = document.getElementById("location-cards-grid");
  const statusPill = document.getElementById("status-pill");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const btnCurrentTime = document.getElementById("btn-current-time");
  const btnAddLocation = document.getElementById("btn-add-location");

  const overlapTitle = document.getElementById("overlap-title");
  const overlapTitleText = document.getElementById("overlap-title-text");
  const overlapIcon = document.getElementById("overlap-icon");
  const overlapDesc = document.getElementById("overlap-desc");

  const timelineTrack = document.getElementById("timeline-track");
  const scrubberHandle = document.getElementById("scrubber-handle");
  const timelineReferenceText = document.getElementById("timeline-reference-text");

  const advancedSection = document.getElementById("advanced-section");
  const advancedToggleHeader = document.getElementById("advanced-toggle-header");
  const workingHoursGrid = document.getElementById("working-hours-grid");
  const checkbox12h = document.getElementById("checkbox-12h");

  const modalAddLocation = document.getElementById("modal-add-location");
  const btnModalClose = document.getElementById("btn-modal-close");
  const modalSearchInput = document.getElementById("modal-search-input");
  const modalResultsList = document.getElementById("modal-results-list");
  const toastEl = document.getElementById("toast");

  // ========================================================================
  // Initialization
  // ========================================================================
  function init() {
    initTimelineAnchor();

    checkbox12h.checked = state.use12Hour;

    setupEventListeners();
    renderAll();

    // Auto-update live time every minute
    liveTimerInterval = setInterval(() => {
      if (isAtLiveCurrentTime()) {
        initTimelineAnchor();
        renderAll();
      }
    }, 60000);
  }

  // Anchor timeline: current reference time is at slot 4,
  // so timeline spans from [referenceTime - 2 hours] to [referenceTime + 22 hours] (48 slots of 30 mins)
  function initTimelineAnchor() {
    const now = new Date();
    const minutes = now.getMinutes();
    const roundedMinutes = minutes >= 30 ? 30 : 0;
    const currentAnchor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), roundedMinutes, 0, 0);

    // Timeline begins 2 hours (4 slots * 30 min) earlier
    timelineBaseDate = new Date(currentAnchor.getTime() - 4 * 30 * 60 * 1000);
    selectedSlotIndex = 4;
  }

  function getSlotDate(slotIndex) {
    return new Date(timelineBaseDate.getTime() + slotIndex * 30 * 60 * 1000);
  }

  function getSelectedDate() {
    return getSlotDate(selectedSlotIndex);
  }

  function isAtLiveCurrentTime() {
    return selectedSlotIndex === 4;
  }

  // ========================================================================
  // Persistence
  // ========================================================================
  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.locations && parsed.locations.length > 0) {
          return { ...DEFAULT_STATE, ...parsed };
        }
      }
    } catch (e) {
      console.warn("Could not load saved state", e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Could not save state", e);
    }
  }

  // ========================================================================
  // Timezone Formatting Helpers
  // ========================================================================
  function getTimeInTimezone(date, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false
    });

    const parts = formatter.formatToParts(date);
    const map = {};
    for (const p of parts) map[p.type] = p.value;

    return {
      hour: parseInt(map.hour, 10),
      minute: parseInt(map.minute, 10),
      day: parseInt(map.day, 10),
      month: parseInt(map.month, 10),
      year: parseInt(map.year, 10),
      weekday: map.weekday
    };
  }

  function getGmtOffset(date, timeZone) {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "shortOffset"
      });
      const parts = formatter.formatToParts(date);
      const tz = parts.find(p => p.type === "timeZoneName");
      if (tz && tz.value) {
        return tz.value.replace("UTC", "GMT");
      }
    } catch (e) {}
    return "GMT";
  }

  function formatTimeDisplay(hour, minute, use12h) {
    if (use12h) {
      const period = hour >= 12 ? "PM" : "AM";
      const h12 = hour % 12 === 0 ? 12 : hour % 12;
      return `${String(h12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`;
    }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function formatTimeOption(decimalHours) {
    const totalMinutes = Math.round(decimalHours * 60) % 1440;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const period = decimalHours === 24 || h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
  }

  function formatDateShort(weekday, day, month) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${weekday} ${day} ${months[month - 1]}`;
  }

  // Exact British style "Wednesday 28 October" matching the screenshot
  function formatDateFull(date, timeZone) {
    const { day, month } = getTimeInTimezone(date, timeZone);
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const weekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" });
    const weekdayName = weekdayFormatter.format(date);
    return `${weekdayName} ${day} ${monthNames[month - 1]}`;
  }

  // ========================================================================
  // Working Hours & Overlap Evaluation
  // ========================================================================
  function evaluateLocationStatus(location, date) {
    const { hour, minute } = getTimeInTimezone(date, location.timezone);
    const currentMin = hour * 60 + minute;
    const startMin = Math.round(location.workStart * 60);
    const endMin = Math.round(location.workEnd * 60);

    // Matching start and end means working 24/7
    if (startMin === endMin) {
      return { status: "within", label: "Within working hours" };
    }

    let isWithin = false;
    if (startMin < endMin) {
      isWithin = currentMin >= startMin && currentMin < endMin;
    } else {
      // Overnight hours (e.g. 20:00 to 04:00)
      isWithin = currentMin >= startMin || currentMin < endMin;
    }

    if (isWithin) {
      return { status: "within", label: "Within working hours" };
    }

    // Check 1-hour buffer (within 60 minutes of start or end)
    const diffBefore = (startMin - currentMin + 1440) % 1440;
    const diffAfter = (currentMin - endMin + 1440) % 1440;

    if (diffBefore <= 60 || diffAfter <= 60) {
      return { status: "near", label: "Within 1 hour" };
    }

    return { status: "outside", label: "Outside working hours" };
  }

  function evaluateSlotOverall(slotDate) {
    if (state.locations.length === 0) return "outside";

    let hasNear = false;
    for (const loc of state.locations) {
      const res = evaluateLocationStatus(loc, slotDate);
      if (res.status === "outside") {
        return "outside"; // Red stripe
      }
      if (res.status === "near") {
        hasNear = true;
      }
    }

    return hasNear ? "near" : "perfect";
  }

  // ========================================================================
  // Rendering
  // ========================================================================
  function renderAll() {
    const selectedDate = getSelectedDate();
    const refLocation = state.locations[state.referenceIndex] || state.locations[0];

    // 1. Day Header
    if (refLocation) {
      dayMainHeading.textContent = formatDateFull(selectedDate, refLocation.timezone);
    }
    locationsCounter.textContent = `${state.locations.length} of ${MAX_RECOMMENDED_LOCATIONS} locations`;

    // 2. Status Pill (Exploring time vs Live time)
    const isLive = isAtLiveCurrentTime();
    if (isLive) {
      statusDot.className = "status-dot live";
      statusText.textContent = "Live time";
    } else {
      statusDot.className = "status-dot";
      statusText.textContent = "Exploring time";
    }

    // 3. Location Cards
    renderLocationCards(selectedDate);

    // 4. Timeline Bar & Scrubber
    renderTimeline(selectedDate);

    // 5. Overlap Headline
    renderOverlapHeader(selectedDate);

    // 6. Working Hours in Advanced Settings
    renderWorkingHoursGrid();

    // 7. Reference note
    if (refLocation) {
      timelineReferenceText.textContent = `Times shown in ${refLocation.city}`;
    }
  }

  function renderLocationCards(selectedDate) {
    locationCardsGrid.innerHTML = "";

    const refLocation = state.locations[state.referenceIndex] || state.locations[0];
    const refTime = refLocation ? getTimeInTimezone(selectedDate, refLocation.timezone) : null;

    state.locations.forEach((loc, index) => {
      const isReference = index === state.referenceIndex;
      const timeInfo = getTimeInTimezone(selectedDate, loc.timezone);
      const gmtOffset = getGmtOffset(selectedDate, loc.timezone);
      const evalResult = evaluateLocationStatus(loc, selectedDate);

      const card = document.createElement("div");
      card.className = `location-card${isReference ? " is-reference" : ""}`;

      // Date offset relative to reference location
      let offsetBadge = "";
      if (refTime) {
        const refDayCode = refTime.year * 400 + refTime.month * 32 + refTime.day;
        const locDayCode = timeInfo.year * 400 + timeInfo.month * 32 + timeInfo.day;
        const diffDays = locDayCode - refDayCode;
        if (diffDays > 0) offsetBadge = `<span class="date-offset-pill">+${diffDays} day</span>`;
        else if (diffDays < 0) offsetBadge = `<span class="date-offset-pill">${diffDays} day</span>`;
      }

      // Status icon
      let statusIconSvg = "";
      if (evalResult.status === "within") {
        statusIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      } else if (evalResult.status === "near") {
        statusIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
      } else {
        statusIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      }

      card.innerHTML = `
        <div class="card-top">
          <div class="location-title">${escapeHtml(loc.city)}</div>
          <button class="btn-remove-location" data-index="${index}" aria-label="Remove ${escapeHtml(loc.city)}" title="Remove location">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="location-subtitle">
          <span>${escapeHtml(gmtOffset)}</span>
          ${isReference ? `<span class="reference-tag">· timeline reference</span>` : `<span class="reference-tag clickable" data-set-ref="${index}" title="Click to make timeline reference">· set as reference</span>`}
        </div>

        <div class="location-time">
          ${formatTimeDisplay(timeInfo.hour, timeInfo.minute, state.use12Hour)}
        </div>

        <div class="location-date">
          <span>${formatDateShort(timeInfo.weekday, timeInfo.day, timeInfo.month)}</span>
          ${offsetBadge}
        </div>

        <div class="location-status ${evalResult.status}">
          ${statusIconSvg}
          <span>${evalResult.label}</span>
        </div>
      `;

      locationCardsGrid.appendChild(card);
    });

    // Event listeners
    locationCardsGrid.querySelectorAll(".btn-remove-location").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        removeLocation(idx);
      });
    });

    locationCardsGrid.querySelectorAll("[data-set-ref]").forEach(el => {
      el.addEventListener("click", e => {
        e.stopPropagation();
        const idx = parseInt(el.dataset.setRef, 10);
        setReferenceLocation(idx);
      });
    });
  }

  function renderTimeline(selectedDate) {
    const handle = scrubberHandle;
    timelineTrack.innerHTML = "";
    timelineTrack.appendChild(handle);

    for (let i = 0; i < 48; i++) {
      const slotDate = getSlotDate(i);
      const overall = evaluateSlotOverall(slotDate);

      const slotEl = document.createElement("div");
      slotEl.className = `timeline-slot ${overall}`;
      slotEl.dataset.index = i;
      slotEl.title = `Slot ${i + 1}/48 (${formatSlotTimeInRef(slotDate)})`;

      timelineTrack.appendChild(slotEl);
    }

    updateScrubberPosition();
    updateTimelineLabels();
  }

  function formatSlotTimeInRef(date) {
    const ref = state.locations[state.referenceIndex] || state.locations[0];
    if (!ref) return "";
    const t = getTimeInTimezone(date, ref.timezone);
    return formatTimeDisplay(t.hour, t.minute, state.use12Hour);
  }

  function updateTimelineLabels() {
    const ref = state.locations[state.referenceIndex] || state.locations[0];
    if (!ref) return;

    // Slots at 0h, 6h, 12h, 18h, and 23.5h
    const labelIndices = [0, 12, 24, 36, 47];
    labelIndices.forEach((slotIdx, i) => {
      const el = document.getElementById(`label-${i}`);
      if (el) {
        const slotDate = getSlotDate(slotIdx);
        const t = getTimeInTimezone(slotDate, ref.timezone);
        el.textContent = formatTimeDisplay(t.hour, t.minute, state.use12Hour);
      }
    });
  }

  function updateScrubberPosition() {
    const trackWidth = timelineTrack.offsetWidth;
    if (!trackWidth) return;

    const slotWidth = trackWidth / 48;
    const centerOffset = (selectedSlotIndex + 0.5) * slotWidth;
    scrubberHandle.style.left = `${centerOffset}px`;
  }

  function renderOverlapHeader(selectedDate) {
    const currentOverall = evaluateSlotOverall(selectedDate);

    overlapTitle.className = `overlap-title ${currentOverall}`;

    if (currentOverall === "perfect") {
      overlapTitleText.textContent = "A perfect overlap";
      overlapDesc.textContent = "Shared availability across the next 24 hours.";
      overlapIcon.innerHTML = `<polyline points="20 6 9 17 4 12"/>`;
    } else if (currentOverall === "near") {
      overlapTitleText.textContent = "Within 1 hour buffer";
      overlapDesc.textContent = "Everyone is within one hour of normal working hours.";
      overlapIcon.innerHTML = `<line x1="5" y1="12" x2="19" y2="12"/>`;
    } else {
      overlapTitleText.textContent = "Outside hours";
      overlapDesc.textContent = "At least one location is outside working hours.";
      overlapIcon.innerHTML = `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`;
    }
  }

  function renderWorkingHoursGrid() {
    workingHoursGrid.innerHTML = "";

    state.locations.forEach((loc, index) => {
      const card = document.createElement("div");
      card.className = "working-hours-card";

      const startOptions = generateTimeOptions(loc.workStart);
      const endOptions = generateTimeOptions(loc.workEnd);

      card.innerHTML = `
        <div class="working-hours-city">${escapeHtml(loc.city)}</div>
        <div class="time-range-row">
          <div class="time-input-wrap">
            <select class="time-input-select" data-type="start" data-index="${index}">
              ${startOptions}
            </select>
            <svg class="time-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <span class="time-range-separator">to</span>
          <div class="time-input-wrap">
            <select class="time-input-select" data-type="end" data-index="${index}">
              ${endOptions}
            </select>
            <svg class="time-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
        </div>
      `;

      workingHoursGrid.appendChild(card);
    });

    workingHoursGrid.querySelectorAll(".time-input-select").forEach(select => {
      select.addEventListener("change", e => {
        const idx = parseInt(select.dataset.index, 10);
        const type = select.dataset.type;
        const val = parseFloat(select.value);

        if (type === "start") {
          state.locations[idx].workStart = val;
        } else {
          state.locations[idx].workEnd = val;
        }
        saveState();
        renderAll();
        showToast(`Updated hours for ${state.locations[idx].city}`);
      });
    });
  }

  function generateTimeOptions(selectedDecimal) {
    let options = "";
    // Every 30 minutes from 0.0 to 24.0
    for (let h = 0; h <= 24; h += 0.5) {
      const isSelected = Math.abs(h - selectedDecimal) < 0.01;
      const label = formatTimeOption(h);
      options += `<option value="${h}" ${isSelected ? "selected" : ""}>${label}</option>`;
    }
    return options;
  }

  // ========================================================================
  // Location Operations
  // ========================================================================
  function addLocation(cityObj) {
    const exists = state.locations.some(l => l.city.toLowerCase() === cityObj.city.toLowerCase());
    if (exists) {
      showToast(`${cityObj.city} is already added`);
      closeModal();
      return;
    }

    state.locations.push({
      city: cityObj.city,
      country: cityObj.country,
      timezone: cityObj.timezone,
      workStart: 8,
      workEnd: 18
    });

    saveState();
    closeModal();
    renderAll();
    showToast(`Added ${cityObj.city}`);
  }

  function removeLocation(index) {
    if (state.locations.length <= 1) {
      showToast("Keep at least one location");
      return;
    }

    const removed = state.locations[index];
    state.locations.splice(index, 1);

    if (state.referenceIndex >= state.locations.length) {
      state.referenceIndex = 0;
    }

    saveState();
    renderAll();
    showToast(`Removed ${removed.city}`);
  }

  function setReferenceLocation(index) {
    if (index >= 0 && index < state.locations.length) {
      state.referenceIndex = index;
      saveState();
      renderAll();
      showToast(`Set ${state.locations[index].city} as timeline reference`);
    }
  }

  // ========================================================================
  // Scrubber Drag & Click Handling
  // ========================================================================
  function handleTimelinePointer(clientX) {
    const rect = timelineTrack.getBoundingClientRect();
    let relativeX = clientX - rect.left;
    if (relativeX < 0) relativeX = 0;
    if (relativeX > rect.width) relativeX = rect.width;

    const slotFraction = relativeX / rect.width;
    let slotIdx = Math.floor(slotFraction * 48);
    if (slotIdx > 47) slotIdx = 47;
    if (slotIdx < 0) slotIdx = 0;

    if (slotIdx !== selectedSlotIndex) {
      selectedSlotIndex = slotIdx;
      renderAll();
    }
  }

  function setupEventListeners() {
    timelineTrack.addEventListener("click", e => {
      handleTimelinePointer(e.clientX);
    });

    // Scrubber drag (Mouse)
    scrubberHandle.addEventListener("mousedown", e => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingScrubber = true;
      document.body.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", e => {
      if (isDraggingScrubber) {
        handleTimelinePointer(e.clientX);
      }
    });

    window.addEventListener("mouseup", () => {
      if (isDraggingScrubber) {
        isDraggingScrubber = false;
        document.body.style.cursor = "";
      }
    });

    // Scrubber drag (Touch for mobile)
    scrubberHandle.addEventListener("touchstart", e => {
      e.stopPropagation();
      isDraggingScrubber = true;
    }, { passive: true });

    window.addEventListener("touchmove", e => {
      if (isDraggingScrubber && e.touches[0]) {
        handleTimelinePointer(e.touches[0].clientX);
      }
    }, { passive: true });

    window.addEventListener("touchend", () => {
      isDraggingScrubber = false;
    });

    // Current Time button
    btnCurrentTime.addEventListener("click", () => {
      initTimelineAnchor();
      renderAll();
      showToast("Reset to live current time");
    });

    // Status pill click also snaps to current time
    statusPill.addEventListener("click", () => {
      initTimelineAnchor();
      renderAll();
      showToast("Snapped to live time");
    });

    // Advanced settings accordion toggle
    advancedToggleHeader.addEventListener("click", () => {
      advancedSection.classList.toggle("is-open");
    });

    // 12-hour format checkbox
    checkbox12h.addEventListener("change", () => {
      state.use12Hour = checkbox12h.checked;
      saveState();
      renderAll();
    });

    // Add Location Modal
    btnAddLocation.addEventListener("click", openModal);
    btnModalClose.addEventListener("click", closeModal);
    modalAddLocation.addEventListener("click", e => {
      if (e.target === modalAddLocation) closeModal();
    });

    modalSearchInput.addEventListener("input", e => {
      renderSearchResults(e.target.value);
    });

    modalAddLocation.querySelectorAll(".popular-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const cityName = chip.dataset.city;
        const found = GLOBAL_CITIES.find(c => c.city.toLowerCase() === cityName.toLowerCase());
        if (found) addLocation(found);
      });
    });

    // Keyboard navigation
    window.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        closeModal();
      } else if (e.key === "ArrowLeft") {
        if (selectedSlotIndex > 0) {
          selectedSlotIndex--;
          renderAll();
        }
      } else if (e.key === "ArrowRight") {
        if (selectedSlotIndex < 47) {
          selectedSlotIndex++;
          renderAll();
        }
      }
    });

    window.addEventListener("resize", () => {
      updateScrubberPosition();
    });
  }

  // ========================================================================
  // Search Modal
  // ========================================================================
  function openModal() {
    modalAddLocation.classList.add("is-open");
    modalSearchInput.value = "";
    renderSearchResults("");
    setTimeout(() => modalSearchInput.focus(), 50);
  }

  function closeModal() {
    modalAddLocation.classList.remove("is-open");
  }

  function renderSearchResults(query) {
    const q = query.trim().toLowerCase();
    const now = new Date();

    let matches = GLOBAL_CITIES;
    if (q) {
      matches = GLOBAL_CITIES.filter(c =>
        c.city.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q) ||
        c.timezone.toLowerCase().includes(q)
      );
    }

    modalResultsList.innerHTML = "";

    if (matches.length === 0) {
      modalResultsList.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13.5px;">No locations found matching "${escapeHtml(query)}"</div>`;
      return;
    }

    matches.slice(0, 30).forEach(c => {
      const timeInfo = getTimeInTimezone(now, c.timezone);
      const offset = getGmtOffset(now, c.timezone);

      const item = document.createElement("div");
      item.className = "result-item";
      item.innerHTML = `
        <div class="result-city-info">
          <span class="result-city-name">${escapeHtml(c.city)}</span>
          <span class="result-city-sub">${escapeHtml(c.country)} · ${escapeHtml(c.region || "")}</span>
        </div>
        <div class="result-time-info">
          <span class="result-local-time">${formatTimeDisplay(timeInfo.hour, timeInfo.minute, state.use12Hour)}</span>
          <span class="result-offset">${escapeHtml(offset)}</span>
        </div>
      `;

      item.addEventListener("click", () => {
        addLocation(c);
      });

      modalResultsList.appendChild(item);
    });
  }

  // ========================================================================
  // Toast Helper
  // ========================================================================
  let toastTimeout = null;
  function showToast(message) {
    if (toastTimeout) clearTimeout(toastTimeout);
    toastEl.textContent = message;
    toastEl.classList.add("show");
    toastTimeout = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2400);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

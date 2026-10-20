export const paths = {
  arrow: "M5 12h14m-5-5 5 5-5 5",
  back: "M19 12H5m5-5-5 5 5 5",
  chevron: "m9 5 7 7-7 7",
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  history: "M3 12a9 9 0 1 0 3-6M3 3v5h5m4-1v5l3 2",
  user: "M20 21v-2a7 7 0 0 0-14 0v2m10-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  scale:
    "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm2 5a6 6 0 0 1 8 0l-4 5Zm4 2 2-4",
  shield: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Zm-4 9 3 3 5-6",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  activity: "M2 12h5l3-8 4 16 3-8h5",
  bluetooth: "m7 7 10 10-5 4V3l5 4L7 17",
  signal: "M4 18v2m5-7v7m5-12v12m5-17v17",
  check: "m5 12 4 4L19 6",
  leaf: "M20 3C8 2 3 7 5 14s14 10 15-11ZM5 20 16 8",
  ruler: "m3 17 14-14 4 4L7 21Zm6-6 3 3m1-7 3 3",
  lock: "M5 10h14v11H5Zm3 0V7a4 4 0 0 1 8 0v3",
  phone: "M7 2h10v20H7Zm4 16h2",
  close: "m6 6 12 12M6 18 18 6",
  wifi: "M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0m-3 3h.01",
  battery: "M2 7h17v10H2Zm20 3v4M5 10h11v4H5Z",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2",
  edit: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z",
  info: "M12 11v6m0-10v.01m9 5a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  logout: "M9 4H4v16h5m-1-8h13m-5-5 5 5-5 5",
};

export const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.activity}"/></svg>`;

export const logo = () =>
  `<div class="brand"><svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M9 32a16 16 0 1 1 23-2" stroke="#8fc1d1" stroke-width="2"/><path d="M13 29a11 11 0 1 1 15-1" stroke="#4e96ae" stroke-width="2"/><path d="m14 22 5 5 9-14" stroke="#4e96ae" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="32" cy="11" r="3" fill="#f5d574"/></svg><span>Dia<span>Scale</span></span></div>`;

export const scaleArt = () =>
  `<svg viewBox="0 0 180 180" fill="none" aria-hidden="true"><circle cx="112" cy="64" r="48" stroke="#f2d273" stroke-width="6"/><rect x="27" y="49" width="121" height="113" rx="25" fill="#fcfefa" stroke="#8dbac9" stroke-width="2" transform="rotate(-9 87 106)"/><rect x="64" y="64" width="48" height="28" rx="7" fill="#e0eef1" transform="rotate(-9 88 78)"/><path d="m81 78 5 4 8-11" stroke="#4e96ae" stroke-width="2" stroke-linecap="round"/><rect x="42" y="112" width="32" height="32" rx="12" fill="#dbe9ec" transform="rotate(-9 58 128)"/><rect x="103" y="102" width="32" height="32" rx="12" fill="#dbe9ec" transform="rotate(-9 119 118)"/><circle cx="33" cy="45" r="5" fill="#a9ccd7"/><path d="M153 139v12m-6-6h12" stroke="#7db2c3" stroke-width="2" stroke-linecap="round"/></svg>`;

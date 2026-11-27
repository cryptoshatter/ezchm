import type { ReactNode } from "react";

function I({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const IconSidebar = () => (
  <I>
    <rect x="1.8" y="2.5" width="12.4" height="11" rx="2" />
    <path d="M6 2.5v11" />
  </I>
);
export const IconBack = () => (
  <I>
    <path d="M10 3 5 8l5 5" />
  </I>
);
export const IconForward = () => (
  <I>
    <path d="m6 3 5 5-5 5" />
  </I>
);
export const IconHome = () => (
  <I>
    <path d="M2.5 7.2 8 2.8l5.5 4.4V13a.8.8 0 0 1-.8.8H3.3a.8.8 0 0 1-.8-.8z" />
    <path d="M6.3 13.8V9.6h3.4v4.2" />
  </I>
);
export const IconStar = ({ filled }: { filled?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
    <path d="m8 1.9 1.85 3.85 4.2.55-3.07 2.92.78 4.17L8 11.37l-3.76 2.02.78-4.17L1.95 6.3l4.2-.55z" />
  </svg>
);
export const IconSettings = () => (
  <I>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v1.7M8 12.8v1.7M14.5 8h-1.7M3.2 8H1.5M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2M12.6 12.6l-1.2-1.2M4.6 4.6 3.4 3.4" />
  </I>
);
export const IconSun = () => (
  <I>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11 3.05 3.05" />
  </I>
);
export const IconMoon = () => (
  <I>
    <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z" />
  </I>
);
export const IconToc = () => (
  <I>
    <path d="M2 3.5h1M2 8h1M2 12.5h1M5.5 3.5H14M7.5 8H14M7.5 12.5H14" />
  </I>
);
export const IconIndex = () => (
  <I>
    <path d="M3 13 6 3h1l3 10M4.2 9.5h4.6M11.5 5.5h3M11.5 9h3M11.5 12.5h3" />
  </I>
);
export const IconSearch = () => (
  <I>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3.5 3.5" />
  </I>
);
export const IconBookmarks = () => (
  <I>
    <path d="M4 2h8v12l-4-3-4 3z" />
  </I>
);
export const IconFiles = () => (
  <I>
    <path d="M2 4.2c0-.66.54-1.2 1.2-1.2h3l1.5 1.6h5.1c.66 0 1.2.54 1.2 1.2v6.4c0 .66-.54 1.2-1.2 1.2H3.2c-.66 0-1.2-.54-1.2-1.2z" />
  </I>
);
export const IconFormat = () => (
  <I>
    <path d="M2 3h12M5 6.5h9M5 10h9M2 13.5h12" />
  </I>
);
export const IconClose = ({ size = 14 }: { size?: number }) => (
  <I size={size}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </I>
);
export const IconChevron = ({ open }: { open?: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .12s" }}>
    <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
  </svg>
);
export const IconBook = () => (
  <I size={20}>
    <path d="M8 3.6C6.6 2.7 4.6 2.4 2 2.6v10c2.6-.2 4.6.1 6 1 1.4-.9 3.4-1.2 6-1v-10c-2.6-.2-4.6.1-6 1zM8 3.6v10" />
  </I>
);
export const IconFile = () => (
  <I size={20}>
    <path d="M9.5 1.8H4.2c-.66 0-1.2.54-1.2 1.2v10c0 .66.54 1.2 1.2 1.2h7.6c.66 0 1.2-.54 1.2-1.2V5.3z" />
    <path d="M9.5 1.8v3.5H13M6 9.2 4.8 10.4 6 11.6M10 9.2l1.2 1.2-1.2 1.2" />
  </I>
);
export const IconFolder = () => (
  <I size={20}>
    <path d="M2 4.2c0-.66.54-1.2 1.2-1.2h3l1.5 1.6h5.1c.66 0 1.2.54 1.2 1.2v6.4c0 .66-.54 1.2-1.2 1.2H3.2c-.66 0-1.2-.54-1.2-1.2z" />
  </I>
);
export const IconText = () => (
  <I>
    <path d="M2.5 13 5.5 3h1l3 10M3.5 9.6h5M11 8.5c.5-.6 1.1-.9 1.8-.9 1 0 1.7.6 1.7 1.6V13M14.5 10.6c-2.4 0-3.6.5-3.6 1.4 0 .6.5 1 1.2 1 1.3 0 2.4-.9 2.4-2.4" />
  </I>
);
export const IconEdit = () => (
  <I>
    <path d="M10.8 2.7l2.5 2.5L6 12.5H3.5V10z" />
  </I>
);
export const IconPlus = () => (
  <I>
    <path d="M8 3v10M3 8h10" />
  </I>
);
export const IconAgent = () => (
  <I>
    <path d="M8 1.8c.4 2.9 1.4 3.9 4.2 4.2-2.8.4-3.8 1.4-4.2 4.2-.4-2.8-1.4-3.8-4.2-4.2 2.8-.3 3.8-1.3 4.2-4.2z" />
    <path d="M12.5 10.2c.2 1.4.7 1.9 2 2-1.3.2-1.8.7-2 2-.2-1.3-.7-1.8-2-2 1.3-.1 1.8-.6 2-2z" />
  </I>
);

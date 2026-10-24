import type { ReactNode } from 'react';

/** Small inline SVG icon set (stroke icons that inherit `currentColor`), so no icon font or image needs loading. */
function Svg({ children, size = 16, fill = 'none' }: { children: ReactNode; size?: number; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const Logo = ({ size = 34 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <rect width="40" height="40" rx="9" fill="#1e2a3d" />
    <g stroke="#6aa9ff" strokeWidth="2" strokeLinecap="round" fill="none">
      <path d="M12 13l8 7M28 13l-8 7M20 20v9" />
    </g>
    <circle cx="12" cy="13" r="3.4" fill="#3794ff" />
    <circle cx="28" cy="13" r="3.4" fill="#89d185" />
    <circle cx="20" cy="29" r="3.4" fill="#b180d7" />
  </svg>
);
export const IconSearch = () => (<Svg><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></Svg>);
export const IconFilter = () => (<Svg><path d="M3.5 5h17l-6.5 8v6l-4-2v-4z" /></Svg>);
export const IconScan = () => (<Svg><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" /><path d="M8 12h8" /></Svg>);
export const IconFit = () => (<Svg><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" /></Svg>);
export const IconLayout = () => (<Svg><path d="M4 19l9-9M14 4l.8 2.2L17 7l-2.2.8L14 10l-.8-2.2L11 7l2.2-.8zM18.5 12l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" /></Svg>);
export const IconExport = () => (<Svg><path d="M12 15V4M8 8l4-4 4 4M5 14v5h14v-5" /></Svg>);
export const IconClose = () => (<Svg size={14}><path d="M6 6l12 12M18 6L6 18" /></Svg>);
export const IconExpand = () => (<Svg size={14}><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></Svg>);
export const IconChevronDown = () => (<Svg size={14}><path d="M6 9l6 6 6-6" /></Svg>);
export const IconChevronUp = () => (<Svg size={14}><path d="M6 15l6-6 6 6" /></Svg>);
export const IconChevronRight = () => (<Svg size={14}><path d="M9 6l6 6-6 6" /></Svg>);
export const IconArrowRight = () => (<Svg size={16}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>);
export const IconLock = ({ locked }: { locked: boolean }) => (<Svg><rect x="5" y="11" width="14" height="9" rx="2" />{locked ? <path d="M8 11V8a4 4 0 018 0v3" /> : <path d="M8 11V8a4 4 0 017.5-2" />}</Svg>);
export const IconOpen = () => (<Svg><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></Svg>);
export const IconReset = () => (<Svg><path d="M4 12a8 8 0 108-8H7M7 4L4 7l3 3" /></Svg>);
export const IconGlobe = () => (<Svg><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.5 2.3 2.5 13.7 0 16M12 4c-2.5 2.3-2.5 13.7 0 16" /></Svg>);
export const IconBolt = () => (<Svg><path d="M13 3L5 13h6l-1 8 8-10h-6z" /></Svg>);
export const IconCog = () => (<Svg><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></Svg>);
export const IconDatabase = () => (<Svg><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></Svg>);
export const IconCloud = () => (<Svg><path d="M7 18a4 4 0 01-.5-8 5.5 5.5 0 0110.7 1.2A3.5 3.5 0 0117 18z" /></Svg>);
export const IconWarning = () => (<Svg><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></Svg>);
export const IconFile = () => (<Svg size={12}><path d="M7 3h7l4 4v14H7zM14 3v4h4" /></Svg>);

/** Hexagon-cube glyph used for backend nodes (controller, service, …) like in the reference design. */
export const IconCube = ({ size = 20 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M12 12l8-4.5M12 12L4 7.5M12 12v9" />
  </Svg>
);

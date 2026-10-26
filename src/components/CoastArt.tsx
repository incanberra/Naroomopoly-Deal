// Original vector artwork: a stylised Eurobodalla inlet, headlands and a coastal shack.
export function CoastArt({
  variant = 0,
  className = '',
}: {
  variant?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 500 360"
      role="img"
      aria-label="Illustration of South Coast headlands and ocean"
    >
      <defs>
        <linearGradient id={`sky${variant}`} x2="0" y2="1">
          <stop stopColor={variant % 2 ? '#bbd8d9' : '#c5ddd4'} />
          <stop offset="1" stopColor="#f2dfb5" />
        </linearGradient>
        <pattern id={`sea${variant}`} width="60" height="24" patternUnits="userSpaceOnUse">
          <path
            d="M0 12q15-9 30 0t30 0"
            fill="none"
            stroke="#e2ead4"
            strokeWidth="1.5"
            opacity=".4"
          />
        </pattern>
      </defs>
      <path fill={`url(#sky${variant})`} d="M0 0h500v360H0z" />
      <circle cx={variant % 2 ? 365 : 110} cy="85" r="36" fill="#f7e6b4" />
      <path d="M0 150q110-55 210 0t290-20v230H0" fill="#739d8c" />
      <path d="M0 192q100-70 230-5t270-20v193H0" fill="#2b6770" />
      <path d="M0 218q130-30 235 20t265-30v152H0" fill="#528e96" />
      <path d="M0 218q130-30 235 20t265-30v152H0" fill={`url(#sea${variant})`} />
      <path d="M0 360V235q72-34 151-6t74 47q-88-22-141 8t-2 76" fill="#e8cf99" />
      <path d="M500 360V257q-65-52-140-24t-45 49q83-37 101 78" fill="#326253" />
      <path d="M500 360V294q-58-48-98-10t-12 76" fill="#204c42" />
      <path d="M80 218v-28h39v28" fill="#f3e7cd" />
      <path d="m72 190 28-22 28 22" fill="#a96247" />
      <path d="M95 218v-14h9v14" fill="#3e6a62" />
      <path
        d="M48 220v-54m-18 9q18-34 37 0m-37 10q18-34 37 0"
        fill="none"
        stroke="#365b43"
        strokeWidth="7"
      />
      <path d="m320 95 10-5 10 5m2 16 8-4 8 4" fill="none" stroke="#365a56" strokeWidth="3" />
      <path d="m274 279 8-22 9 22Z" fill="#f9edce" />
      <path d="M283 257v28m-16 0h33l-5 6h-20Z" stroke="#f9edce" fill="#f9edce" />
    </svg>
  );
}

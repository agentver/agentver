type SignInBannerProps = {
  onSignIn: () => void
  onDismiss: () => void
}

export function SignInBanner({ onSignIn, onDismiss }: SignInBannerProps) {
  return (
    <div className="flex animate-[fadeIn_0.3s_ease-out] items-center gap-3 border-primary/15 border-b bg-primary/5 px-4 py-2.5">
      <div className="flex flex-1 items-center gap-2.5">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-primary"
        >
          <circle cx="8" cy="8" r="7" />
          <path d="M8 5v3.5" />
          <circle cx="8" cy="11" r="0.5" fill="currentColor" />
        </svg>
        <span className="flex-1 text-[0.8rem] text-muted-foreground">
          Sign in to sync skills and collaborate with your team
        </span>
        <button
          onClick={onSignIn}
          className="shrink-0 cursor-pointer whitespace-nowrap rounded-md border-none bg-primary px-3.5 py-1.5 font-medium text-[0.775rem] text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
        >
          Sign In
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="flex shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
        </svg>
      </button>
    </div>
  )
}

const ink = "/brand/auth-ink.svg";
const paper = "/brand/auth-paper.svg";

export function Brand({ href }: { readonly href: string }) {
  return (
    <a className="wordmark" href={href}>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet={paper} />
        <img src={ink} alt="Yielded Auth" width="178" height="28" />
      </picture>
    </a>
  );
}

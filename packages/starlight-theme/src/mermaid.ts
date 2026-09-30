const sources = new WeakMap<HTMLElement, string>();
let renderId = 0;

const renderDiagrams = async () => {
  const diagrams = document.querySelectorAll<HTMLElement>(".yl-mermaid");

  if (diagrams.length === 0) return;

  const [{ default: mermaid }] = await Promise.all([import("mermaid"), document.fonts.ready]);
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => styles.getPropertyValue(`--yl-${name}`).trim();

  // Sequence layout also reads the global font size when measuring its labels.
  const typography = {
    fontFamily: styles.getPropertyValue("--yl-font-sans").trim(),
    fontSize: 14,
  };

  mermaid.initialize({
    ...typography,
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    look: "classic",
    htmlLabels: false,
    flowchart: { curve: "linear", minNodeWidth: 0, nodeSpacing: 32, rankSpacing: 40, padding: 12 },
    sequence: {
      width: 96,
      height: 40,
      actorMargin: 40,
      messageMargin: 24,
      diagramMarginX: 12,
      diagramMarginY: 12,
      mirrorActors: false,
      wrap: true,
    },
    themeVariables: {
      darkMode: document.documentElement.dataset.theme !== "light",
      background: color("bg"),
      primaryColor: color("bg-raised"),
      primaryTextColor: color("text"),
      primaryBorderColor: color("border-strong"),
      secondaryColor: color("bg-sunken"),
      secondaryTextColor: color("text"),
      secondaryBorderColor: color("border-strong"),
      tertiaryColor: color("bg-raised"),
      tertiaryTextColor: color("text"),
      tertiaryBorderColor: color("border-strong"),
      lineColor: color("text-muted"),
      textColor: color("text"),
      edgeLabelBackground: color("bg-raised"),
      actorBkg: color("bg-sunken"),
      actorBorder: color("border-strong"),
      actorTextColor: color("text"),
      actorLineColor: color("border-strong"),
      signalColor: color("text-muted"),
      signalTextColor: color("text-muted"),
      clusterBkg: color("bg-sunken"),
      clusterBorder: color("border-strong"),
      fontSize: "14px",
    },
  });

  for (const diagram of diagrams) {
    const source = sources.get(diagram) ?? diagram.querySelector("code")?.textContent;

    if (source === undefined || source === null) continue;

    sources.set(diagram, source);

    const id = `yl-mermaid-${++renderId}`;

    try {
      const { svg } = await mermaid.render(id, source);

      if (!diagram.isConnected) continue;

      diagram.innerHTML = svg;

      const element = diagram.querySelector("svg");

      // Preserve the diagram's text size. Wide diagrams scroll within their own container.
      if (element !== null) element.style.width = `${element.viewBox.baseVal.width}px`;
    } catch (error) {
      // Preserve readable source (or the previous SVG) if a diagram cannot be rendered.
      document.getElementById(`d${id}`)?.remove();
      console.error("Unable to render Mermaid diagram", error);
    }
  }
};

// Mermaid has global configuration: finish a render before applying the next theme.
let rendering = Promise.resolve();

const scheduleRender = () => {
  rendering = rendering.then(renderDiagrams).catch((error: unknown) => {
    console.error("Unable to load Mermaid", error);
  });
};

new MutationObserver(scheduleRender).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});

document.addEventListener("astro:page-load", scheduleRender);
scheduleRender();

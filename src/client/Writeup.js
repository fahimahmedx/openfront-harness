const root = document.documentElement;
const themeButton = document.querySelector("#theme-toggle");
const themeLabel = document.querySelector("#theme-label");
const themeColor = document.querySelector("#theme-color");
const progress = document.querySelector("#read-progress");
const article = document.querySelector("#writeup-article");
const toc = document.querySelector("#toc");

function applyTheme(theme) {
  const dark = theme === "dark";
  root.dataset.theme = theme;
  themeButton?.setAttribute("aria-pressed", String(dark));
  if (themeLabel) themeLabel.textContent = dark ? "Light mode" : "Dark mode";
  if (themeColor) themeColor.content = dark ? "#09140f" : "#f2f0e9";
}

applyTheme(root.dataset.theme === "dark" ? "dark" : "light");
themeButton?.addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("openfront-docs-theme", next);
  } catch {}
});

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const headings = Array.from(article?.querySelectorAll("h2") ?? []);
headings.forEach((heading, index) => {
  heading.id ||= slugify(heading.textContent ?? `section-${index + 1}`);
  if (toc) {
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    link.textContent = (heading.textContent ?? "").replace(/^\d+\.\s*/, "");
    toc.append(link);
  }
});

article?.querySelectorAll("pre").forEach((block) => {
  const language = Array.from(block.querySelector("code")?.classList ?? [])
    .find((value) => value.startsWith("language-"))
    ?.replace("language-", "");
  if (!language) return;
  const label = document.createElement("span");
  label.className = "code-label";
  label.textContent = language;
  block.prepend(label);
});

article?.querySelectorAll("p > img").forEach((image) => {
  const parent = image.parentElement;
  if (!parent) return;
  const figure = document.createElement("figure");
  figure.className = "data-figure";
  const caption = document.createElement("figcaption");
  caption.textContent = image.alt;
  parent.replaceWith(figure);
  figure.append(image, caption);
});

article?.querySelectorAll("table").forEach((table) => {
  const wrapper = document.createElement("div");
  wrapper.className = "table-scroll";
  table.replaceWith(wrapper);
  wrapper.append(table);
});

const tocLinks = Array.from(toc?.querySelectorAll("a") ?? []);
if ("IntersectionObserver" in window && headings.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).at(-1);
      if (!visible) return;
      tocLinks.forEach((link) =>
        link.classList.toggle("active", link.hash === `#${visible.target.id}`),
      );
    },
    { rootMargin: "-18% 0px -70%", threshold: 0 },
  );
  headings.forEach((heading) => observer.observe(heading));
}

function updateProgress() {
  if (!progress || !article) return;
  const start = article.offsetTop;
  const length = Math.max(1, article.offsetHeight - window.innerHeight);
  const ratio = Math.min(1, Math.max(0, (window.scrollY - start) / length));
  progress.style.transform = `scaleX(${ratio})`;
}
window.addEventListener("scroll", updateProgress, { passive: true });
window.addEventListener("resize", updateProgress);
updateProgress();

if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.querySelectorAll("video[autoplay]").forEach((video) => {
    video.pause();
    video.removeAttribute("autoplay");
  });
}

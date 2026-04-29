import { Link } from "react-router-dom";
import { getCurrentUserRole } from "../api/client";
import { getPluginIcon } from "../utils/pluginIcons";
import { useI18n } from "../hooks/useI18n";
import "../styles/MarketingPages.css";

export default function HomePage() {
  const isAdmin = getCurrentUserRole() === "admin";
  const { t } = useI18n();

  const capabilities = [
    {
      title: t("home.capability.builder.title"),
      text: t("home.capability.builder.text"),
      icon: getPluginIcon("foreach", "control"),
      to: "/workflows",
    },
    {
      title: t("home.capability.plugins.title"),
      text: t("home.capability.plugins.text"),
      icon: getPluginIcon("template", "utilities"),
      to: "/plugins",
    },
    {
      title: t("home.capability.credentials.title"),
      text: t("home.capability.credentials.text"),
      icon: getPluginIcon("task", "utilities"),
      to: "/credentials",
    },
    {
      title: t("home.capability.dataStore.title"),
      text: t("home.capability.dataStore.text"),
      icon: getPluginIcon("db.query", "data"),
      to: "/data-store",
    },
    {
      title: t("home.capability.observability.title"),
      text: t("home.capability.observability.text"),
      icon: getPluginIcon("log", "utilities"),
      to: "/runs",
    },
    {
      title: t("home.capability.webhook.title"),
      text: t("home.capability.webhook.text"),
      icon: getPluginIcon("webhook.response", "utilities"),
      to: "/docs",
    },
  ];

  const lifecycle = [
    [t("home.lifecycle.discover.title"), t("home.lifecycle.discover.text")],
    [t("home.lifecycle.build.title"), t("home.lifecycle.build.text")],
    [t("home.lifecycle.operate.title"), t("home.lifecycle.operate.text")],
  ];

  return (
    <div className="pageLayout marketingPage homePage">
      <main className="pageContent homePage__content">
        <section className="homeHeroV2">
          <div className="homeHeroV2__left">
            <span className="marketingKicker">{t("home.hero.kicker")}</span>
            <h1>{t("home.hero.title")}</h1>
            <p>{t("home.hero.subtitle")}</p>
            <div className="homeHeroV2__actions">
              <Link className="marketingButton marketingButton--primary" to="/workflows">
                {t("home.hero.primaryCta")}
              </Link>
              <Link className="marketingButton" to="/docs">
                {t("home.hero.docsCta")}
              </Link>
            </div>
            <div className="homeHeroV2__stats" aria-label={t("home.hero.statsLabel")}>
              <article>
                <strong>{t("home.hero.stat1.value")}</strong>
                <span>{t("home.hero.stat1.label")}</span>
              </article>
              <article>
                <strong>{t("home.hero.stat2.value")}</strong>
                <span>{t("home.hero.stat2.label")}</span>
              </article>
              <article>
                <strong>{t("home.hero.stat3.value")}</strong>
                <span>{t("home.hero.stat3.label")}</span>
              </article>
            </div>
          </div>
        </section>

        <section className="homeCapabilities">
          <div className="marketingSection__header">
            <span className="marketingKicker">{t("home.capabilities.kicker")}</span>
            <h2>{t("home.capabilities.title")}</h2>
          </div>
          <div className="homeCapabilities__grid">
            {capabilities.map((item) => (
              <Link key={item.title} to={item.to} className="homeCapabilityCard">
                <img src={item.icon} alt="" />
                <div>
                  <h1>{item.title}</h1>
                  <p>{item.text}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="homeFlow">
          <div className="marketingSection__header">
            <span className="marketingKicker">{t("home.lifecycle.kicker")}</span>
            <h2>{t("home.lifecycle.title")}</h2>
          </div>
          <div className="homeFlow__grid">
            {lifecycle.map(([title, text], index) => (
              <article key={title} className="homeFlow__item">
                <span>{index + 1}</span>
                <h1>{title}</h1>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="homeBottom">
          <article className="homeBottom__reliability">
            <h1>{t("home.reliability.title")}</h1>
            <p>{t("home.reliability.text")}</p>
            <ul>
              <li>{t("home.reliability.point1")}</li>
              <li>{t("home.reliability.point2")}</li>
              <li>{t("home.reliability.point3")}</li>
            </ul>
          </article>
          <article className="homeBottom__cta">
            <h1>{t("home.cta.title")}</h1>
            <p>{t("home.cta.text")}</p>
            <div className="homeBottom__actions">
              <Link to="/templates" className="marketingButton marketingButton--primary">
                {t("home.cta.templates")}
              </Link>
              <Link to={isAdmin ? "/system" : "/docs"} className="marketingButton">
                {isAdmin ? t("home.cta.system") : t("home.cta.learn")}
              </Link>
            </div>
          </article>
        </section>

      </main>
    </div>
  );
}

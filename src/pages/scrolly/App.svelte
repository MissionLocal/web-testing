<script>
  import { onMount, onDestroy } from "svelte";
  import Network from "../network/App.svelte";
  import { sendScrollyCommand } from "../../lib/scrollyController";

  let stepsEl;
  let step0;
  let observer;

  function setHighlight(on) {
    sendScrollyCommand({ type: "highlightFilters", on });
  }

  onMount(() => {
    // Make sure we start "off"
    setHighlight(false);

    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.target === step0) {
            setHighlight(e.isIntersecting);
          }
        }
      },
      {
        // ✅ IMPORTANT: observe relative to the steps scroller (not the window)
        root: stepsEl,
        threshold: 0.6,

        // ✅ Makes the “active zone” a little easier to hit
        // (i.e., step considered active when it’s in the middle-ish)
        rootMargin: "-20% 0px -20% 0px",
      }
    );

    if (step0) observer.observe(step0);
  });

  onDestroy(() => {
    observer?.disconnect();
    // turn off on teardown
    setHighlight(false);
  });
</script>

<div class="scrolly">
  <!-- Chart column (always visible) -->
  <div class="chart-col">
    <Network />
  </div>

  <!-- Steps column (this scrolls) -->
  <div class="steps" bind:this={stepsEl}>
    <div class="step" bind:this={step0}>
      <h3>Use the buttons to filter</h3>
      <p>These category buttons let you highlight parts of the network.</p>
    </div>

    <div class="spacer"></div>
  </div>
</div>

<style>
  html,
  body {
    height: 100%;
  }

  /* Two-column scrolly; steps scroll inside the right column */
  .scrolly {
    height: 100vh;         /* important for embeds */
    overflow: hidden;      /* prevent body scroll */
    display: grid;
    grid-template-columns: 1.2fr 0.8fr;
    gap: 18px;
    background: white;
  }

  .chart-col {
    height: 100%;
    padding: 8px 0 8px 0;
    overflow: hidden; /* chart stays fixed; only steps scroll */
  }

  .steps {
    height: 100%;
    overflow-y: auto;
    padding: 16px 12px 120px;
    -webkit-overflow-scrolling: touch;
  }

  .step {
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 14px;
    padding: 14px 14px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
    margin: 40vh auto 0; /* comes in after some scroll inside steps */
    max-width: 520px;
  }

  .spacer {
    height: 120vh;
  }

  h3 {
    margin: 0 0 6px 0;
    font-size: 18px;
  }

  p {
    margin: 0;
    font-size: 14px;
    line-height: 1.3;
  }

  /* Mobile: stack chart then steps */
  @media (max-width: 760px) {
    .scrolly {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }

    .chart-col {
      height: auto;
    }

    .steps {
      height: 100%;
    }
  }
</style>

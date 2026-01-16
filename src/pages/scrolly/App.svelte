<script>
  import { onMount, onDestroy } from "svelte";
  import Network from "../network/App.svelte";
  import { sendScrollyCommand } from "../../lib/scrollyController";

  let step0;

  let observer;

  onMount(() => {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.target === step0) {
            if (e.isIntersecting) {
              // ✅ turn ON highlight when slide enters
              sendScrollyCommand({ type: "highlightFilters", on: true });
            } else {
              // ✅ turn OFF when slide exits
              sendScrollyCommand({ type: "highlightFilters", on: false });
            }
          }
        }
      },
      { threshold: 0.6 } // 60% visible = “active”
    );

    if (step0) observer.observe(step0);
  });

  onDestroy(() => {
    observer?.disconnect();
  });
</script>

<div class="scrolly">
  <!-- Sticky chart -->
  <div class="sticky">
    <Network />
  </div>

  <!-- Steps -->
  <div class="steps">
    <div class="step" bind:this={step0}>
      <h3>Use the buttons to filter</h3>
      <p>These category buttons let you highlight parts of the network.</p>
    </div>

    <!-- spacer so you can scroll past the step -->
    <div class="spacer"></div>
  </div>
</div>

<style>
  .scrolly {
    position: relative;
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
  }

  /* Sticky chart stays in view while you scroll */
  .sticky {
    position: sticky;
    top: 0;
    z-index: 0;
    background: white;
    padding-top: 8px;
  }

  .steps {
    position: relative;
    z-index: 1;
    max-width: 520px;
    margin: 0 auto;
    padding: 16px 12px 120px;
  }

  .step {
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 14px;
    padding: 14px 14px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
    margin: 60vh auto 0; /* comes in after some scroll */
  }

  .spacer {
    height: 140vh;
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
</style>

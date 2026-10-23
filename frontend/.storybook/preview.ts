import type { Preview } from "@storybook/react";
import "../src/app/globals.css";

/**
 * Viewport configurations for Chromatic visual regression tests (TEST-104).
 * Three breakpoints are tested on every story:
 *   - mobile:  375 px  (iPhone SE)
 *   - tablet:  768 px  (iPad portrait)
 *   - desktop: 1280 px (standard laptop)
 */
const preview: Preview = {
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Switch between light and dark themes",
      defaultValue: "dark",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === "light" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", theme === "dark");
      document.documentElement.dataset.theme = theme;
      return Story();
    },
  ],
  parameters: {
    // Default viewport shown in Storybook UI
    viewport: {
      viewports: {
        mobile: {
          name: "Mobile (375px)",
          styles: { width: "375px", height: "812px" },
          type: "mobile",
        },
        tablet: {
          name: "Tablet (768px)",
          styles: { width: "768px", height: "1024px" },
          type: "tablet",
        },
        desktop: {
          name: "Desktop (1280px)",
          styles: { width: "1280px", height: "800px" },
          type: "desktop",
        },
      },
      defaultViewport: "desktop",
    },

    // Chromatic: capture all three viewports on every story
    chromatic: {
      viewports: [375, 768, 1280],
      // Delay to allow fonts / animations to settle before snapshot
      delay: 300,
    },

    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;

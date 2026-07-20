// Ports gtm/templates.go: hardcoded example structures that teach LLMs the
// correct GTM API parameter formats. Content is copied verbatim.

export interface TagTemplate {
  name: string;
  description: string;
  type: string;
  parameters: string;
  notes: string;
}

export interface TriggerTemplate {
  name: string;
  description: string;
  type: string;
  filterJson?: string;
  autoEventFilterJson?: string;
  customEventFilterJson?: string;
  notes: string;
}

export function getTagTemplates(): TagTemplate[] {
  return [
    {
      name: "GA4 Configuration",
      description: "Google Analytics 4 configuration tag (fires on all pages)",
      type: "gaawc",
      parameters: `[
  {"type": "template", "key": "measurementId", "value": "G-XXXXXXXXXX"}
]`,
      notes:
        "Use gaawc type for GA4 Config tags. The measurementId should be your GA4 Measurement ID.",
    },
    {
      name: "GA4 Event (Simple)",
      description: "Google Analytics 4 event tag with custom event name",
      type: "gaawe",
      parameters: `[
  {"type": "tagReference", "key": "measurementId", "value": ""},
  {"type": "template", "key": "measurementIdOverride", "value": "{{GA4 Measurement ID}}"},
  {"type": "template", "key": "eventName", "value": "custom_event_name"}
]`,
      notes:
        "Use gaawe type for GA4 Event tags. measurementId must be empty tagReference, use measurementIdOverride for the actual value (variable reference or literal).",
    },
    {
      name: "GA4 Event with Parameters",
      description: "Google Analytics 4 event tag with custom parameters",
      type: "gaawe",
      parameters: `[
  {"type": "tagReference", "key": "measurementId", "value": ""},
  {"type": "template", "key": "measurementIdOverride", "value": "{{GA4 Measurement ID}}"},
  {"type": "template", "key": "eventName", "value": "button_click"},
  {"type": "list", "key": "eventParameters", "list": [
    {"type": "map", "map": [
      {"type": "template", "key": "name", "value": "button_id"},
      {"type": "template", "key": "value", "value": "{{Click ID}}"}
    ]},
    {"type": "map", "map": [
      {"type": "template", "key": "name", "value": "button_text"},
      {"type": "template", "key": "value", "value": "{{Click Text}}"}
    ]}
  ]}
]`,
      notes:
        "Event parameters use name/value pairs inside map structures. Do NOT use the parameter name as the key directly.",
    },
    {
      name: "GA4 Ecommerce Purchase",
      description:
        "Google Analytics 4 ecommerce purchase event (reads items from dataLayer)",
      type: "gaawe",
      parameters: `[
  {"type": "tagReference", "key": "measurementId", "value": ""},
  {"type": "template", "key": "measurementIdOverride", "value": "{{GA4 Measurement ID}}"},
  {"type": "template", "key": "eventName", "value": "purchase"},
  {"type": "boolean", "key": "sendEcommerceData", "value": "true"},
  {"type": "template", "key": "getEcommerceDataFrom", "value": "dataLayer"},
  {"type": "list", "key": "eventParameters", "list": [
    {"type": "map", "map": [
      {"type": "template", "key": "name", "value": "transaction_id"},
      {"type": "template", "key": "value", "value": "{{DL - Transaction ID}}"}
    ]}
  ]}
]`,
      notes:
        "For ecommerce events, set sendEcommerceData=true and getEcommerceDataFrom=dataLayer. The items array will be read automatically from the dataLayer ecommerce object.",
    },
    {
      name: "GA4 Ecommerce Add to Cart",
      description: "Google Analytics 4 ecommerce add_to_cart event",
      type: "gaawe",
      parameters: `[
  {"type": "tagReference", "key": "measurementId", "value": ""},
  {"type": "template", "key": "measurementIdOverride", "value": "{{GA4 Measurement ID}}"},
  {"type": "template", "key": "eventName", "value": "add_to_cart"},
  {"type": "boolean", "key": "sendEcommerceData", "value": "true"},
  {"type": "template", "key": "getEcommerceDataFrom", "value": "dataLayer"}
]`,
      notes: "Similar to purchase, but for add_to_cart event. Items are read from dataLayer.",
    },
    {
      name: "GA4 Ecommerce View Item",
      description: "Google Analytics 4 ecommerce view_item event",
      type: "gaawe",
      parameters: `[
  {"type": "tagReference", "key": "measurementId", "value": ""},
  {"type": "template", "key": "measurementIdOverride", "value": "{{GA4 Measurement ID}}"},
  {"type": "template", "key": "eventName", "value": "view_item"},
  {"type": "boolean", "key": "sendEcommerceData", "value": "true"},
  {"type": "template", "key": "getEcommerceDataFrom", "value": "dataLayer"}
]`,
      notes: "For product detail page views. Items are read from dataLayer.",
    },
    {
      name: "Custom HTML",
      description: "Custom HTML tag for arbitrary JavaScript",
      type: "html",
      parameters: `[
  {"type": "template", "key": "html", "value": "<script>\\n  console.log('Hello from GTM!');\\n</script>"}
]`,
      notes: "Use html type for custom JavaScript. The html parameter contains the script.",
    },
    {
      name: "Custom Image (Pixel)",
      description: "Custom image tag for tracking pixels",
      type: "img",
      parameters: `[
  {"type": "template", "key": "url", "value": "https://example.com/pixel.gif?event=pageview"},
  {"type": "boolean", "key": "useCacheBuster", "value": "true"},
  {"type": "template", "key": "cacheBusterQueryParam", "value": "gtmcb"}
]`,
      notes: "Use img type for tracking pixels. Enable cacheBuster to prevent caching.",
    },
  ];
}

export function getTriggerTemplates(): TriggerTemplate[] {
  return [
    {
      name: "All Pages",
      description: "Fires on every page view",
      type: "pageview",
      notes: "Simple pageview trigger with no filters.",
    },
    {
      name: "Specific Page",
      description: "Fires on a specific page URL",
      type: "pageview",
      filterJson: `[
  {"type": "contains", "parameter": [
    {"type": "template", "key": "arg0", "value": "{{Page URL}}"},
    {"type": "template", "key": "arg1", "value": "/checkout"}
  ]}
]`,
      notes:
        "Use filterJson to match specific pages. arg0 is the variable, arg1 is the value to match.",
    },
    {
      name: "Custom Event",
      description: "Fires on a dataLayer custom event",
      type: "customEvent",
      customEventFilterJson: `[
  {"type": "equals", "parameter": [
    {"type": "template", "key": "arg0", "value": "{{_event}}"},
    {"type": "template", "key": "arg1", "value": "purchase"}
  ]}
]`,
      notes:
        "For customEvent triggers, use customEventFilterJson (not filterJson). The {{_event}} variable matches the dataLayer event name.",
    },
    {
      name: "Click - All Elements",
      description: "Fires on all element clicks",
      type: "linkClick",
      autoEventFilterJson: `[
  {"type": "contains", "parameter": [
    {"type": "template", "key": "arg0", "value": "{{Click Classes}}"},
    {"type": "template", "key": "arg1", "value": "cta-button"}
  ]}
]`,
      notes:
        "Use linkClick for click triggers. Use autoEventFilterJson to filter by click element properties (Click Classes, Click ID, Click URL, etc.).",
    },
    {
      name: "Form Submission",
      description: "Fires on form submissions",
      type: "formSubmission",
      autoEventFilterJson: `[
  {"type": "equals", "parameter": [
    {"type": "template", "key": "arg0", "value": "{{Form ID}}"},
    {"type": "template", "key": "arg1", "value": "contact-form"}
  ]}
]`,
      notes:
        "Use formSubmission type. Use autoEventFilterJson to filter by form properties (Form ID, Form Classes, Form URL, etc.).",
    },
  ];
}

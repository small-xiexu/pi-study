export default function registerSourceMarker(pi) {
  pi.registerFlag("pi-study-package-a", {
    description: "PI_STUDY_PACKAGE_A",
    type: "boolean",
    default: false,
  });
}

// Regenerates deck_icons.json — the white-on-transparent PNG icon set that
// build_deck.js places on colored circles. Only needed when ADDING or
// CHANGING icons; the JSON is committed so the deck rebuilds without this.
//
// Deps are NOT in package.json on purpose (sharp is a heavy native build and
// the default `npm install` should stay light for the docx set). To run:
//   cd tools && npm install react react-dom react-icons sharp --no-save
//   node build_deck_icons.js
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");

const WANTED = {
  ship: fa.FaShip,
  comments: fa.FaComments,
  compass: fa.FaCompass,
  flask: fa.FaFlask,
  anchor: fa.FaAnchor,
  search: fa.FaSearch,
  clipboard: fa.FaClipboardList,
  shield: fa.FaShieldAlt,
  clock: fa.FaRegClock,
  branch: fa.FaCodeBranch,
  eye: fa.FaEye,
  bug: fa.FaBug,
  satellite: fa.FaSatelliteDish,
  plug: fa.FaPlug,
  wave: fa.FaWater,
  book: fa.FaBookOpen,
  chart: fa.FaChartBar,
  scale: fa.FaBalanceScale,
  grad: fa.FaGraduationCap,
  wrench: fa.FaWrench,
  file: fa.FaFileWord,
  server: fa.FaServer,
  route: fa.FaRoute,
  check: fa.FaCheckCircle,
  question: fa.FaQuestionCircle,
};

async function main() {
  const out = {};
  for (const [name, Icon] of Object.entries(WANTED)) {
    const svg = ReactDOMServer.renderToStaticMarkup(
      React.createElement(Icon, { color: "white", size: 256 })
    );
    const png = await sharp(Buffer.from(svg))
      .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    out[name] = png.toString("base64");
  }
  require("fs").writeFileSync(__dirname + "/deck_icons.json", JSON.stringify(out));
  console.log("deck_icons.json:", Object.keys(out).length, "icons");
}
main().catch((e) => { console.error(e); process.exit(1); });

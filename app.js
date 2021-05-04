require("dotenv").config(); // Loads .env file
const puppeteer = require("puppeteer");
const request = require("request-promise-native");
const crypto = require("crypto");
const ora = require("ora");
const figlet = require("figlet");
const baseurl = "https://api.coindcx.com";

/* -------------------------------- database -------------------------------- */

const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");

const adapter = new FileSync("db.json");
const db = low(adapter);

// Set some defaults (required if your JSON file is empty)
db.defaults({ rsi: [], rawrsi: [] }).write();

/* --------------------------------- COLORS --------------------------------- */
const COLORS = {
    HEADER: "\033[95m",
    OKBLUE: "\033[94m",
    OKCYAN: "\033[96m",
    KGREEN: "\033[92m",
    WARNING: "\033[93m",
    FAIL: "\033[91m",
    ENDC: "\033[0m",
    BOLD: "\033[1m",
    UNDERLINE: "\033[4m",
};

function CPrint(text, color = COLORS.OKBLUE) {
    console.log(`${color}${text}${COLORS.ENDC}`);
}

/* --------------------------------- SECRETS -------------------------------- */

const KEY = process.env.key;
const SECRET = process.env.secret;

/* -------------------------------- CONSTANTS ------------------------------- */

const SELLVALUE = +process.env.SELLVALUE;
const BUYVALUE = +process.env.BUYVALUE;
const DP = +process.env.DP;

/* ---------------------------- UTILITY FUNCTIONS --------------------------- */

async function loader(text = "WAIT", time = 5000, complete = "") {
    const spinner = ora("Loading").start();
    await sleep(time);
    spinner.color = "yellow";
    spinner.text = text;
    spinner.succeed(complete);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function BigStyleText(text = "LKT BOT", color = COLORS.HEADER) {
    figlet(text, function (err, data) {
        if (err) {
            console.log("Something went wrong with figlet...");
            console.dir(err);
            return;
        }
        CPrint(data, color);
    });
}

/* --------------------------------- Tickers -------------------------------- */

const TICKER = process.env.TICKER;
const COIN = process.env.COIN;

/* --------------------------- Checking all values -------------------------- */

if (!KEY || !SECRET) {
    console.log("KEY NOT FOUND");
    process.exit();
}

if (!TICKER || !COIN) {
    console.log("TICKER/COIN NOT FOUND");
    process.exit();
}

async function GetRSI(ticker = TICKER) {
    const url = "https://in.tradingview.com/symbols/" + ticker + "/technicals/";
    const browser = await puppeteer.launch({
        args: ["--disable-dev-shm-usage", "--disable-gpu"],
        ignoreDefaultArgs: ["--disable-extensions"],
        headless: true,
    });
    const page = await browser.newPage();
    await page.goto(url);

    const timeFrameClass =
        ".wrap-3obNZqvj > .scrollWrap-3obNZqvj > .tabsWrap-R450LabG > .tabsRow-R450LabG > .tab-R450LabG:nth-child(2)";
    await page.waitForSelector(timeFrameClass);
    await page.click(timeFrameClass);

    await sleep(500);

    const res = await page.$$("td.cell-2-juHm8n");
    const textObject = await res[1].getProperty("textContent");
    const rsi = textObject._remoteObject.value;
    await browser.close();
    return +rsi;
}

async function GetQuantity(dp = DP, currency = COIN) {
    const timeStamp = Math.floor(Date.now());

    const body = {
        timestamp: timeStamp,
    };

    const payload = Buffer.from(JSON.stringify(body)).toString();
    const signature = crypto
        .createHmac("sha256", SECRET)
        .update(payload)
        .digest("hex");

    const options = {
        url: baseurl + "/exchange/v1/users/balances",
        headers: {
            "X-AUTH-APIKEY": KEY,
            "X-AUTH-SIGNATURE": signature,
        },
        json: true,
        body: body,
    };

    const response = await request.post(options);
    for (const coin of response) {
        if (coin["currency"] === currency) {
            const balance = coin["balance"];
            const temp = balance.split(".");
            return +(temp[0] + "." + temp[1].slice(0, dp));
        }
    }
}

async function GetCurrentPrice(type = "ask", currency = TICKER) {
    const response = await request.get(baseurl + "/exchange/ticker");
    const json = JSON.parse(response);

    for (const coin of json) {
        if (coin["market"] === currency) {
            return +coin[type];
        }
    }
}

async function Trade(
    action,
    quantity,
    price,
    type = "limit_order",
    currency = TICKER
) {
    var timeStamp = Math.floor(Date.now());

    body = {
        side: action, //Toggle between 'buy' or 'sell'.
        order_type: type, //Toggle between a 'market_order' or 'limit_order'.
        market: currency, //Replace 'SNTBTC' with your desired market.
        price_per_unit: price, //This parameter is only required for a 'limit_order'
        total_quantity: quantity, //Replace this with the quantity you want
        timestamp: timeStamp,
    };

    const payload = Buffer.from(JSON.stringify(body)).toString();
    const signature = crypto
        .createHmac("sha256", SECRET)
        .update(payload)
        .digest("hex");

    const options = {
        url: baseurl + "/exchange/v1/orders/create",
        headers: {
            "X-AUTH-APIKEY": KEY,
            "X-AUTH-SIGNATURE": signature,
        },
        json: true,
        body: body,
    };

    const response = await request.post(options);
    CPrint(response.body, COLORS.FAIL);
    return response;
}

function SaveRawRSIToDB(value) {
    db.get("rawrsi").push({ id: Date.now(), value }).write();
}

function SaveRSIToDB({ value, price, qty, action }) {
    db.get("rsi").push({ id: Date.now(), value, price, qty, action }).write();
}

let above = false;
let below = false; //toggle to True to BUY at start

let run = true;
BigStyleText();
(async () => {

    while (run) {
        try {
            const RSI = await GetRSI()
            CPrint(`RSI == ${RSI}`, COLORS.WARNING)
            SaveRawRSIToDB(RSI)

            if (RSI > SELLVALUE)  // Checks if the RSI value is greater than the sell value.
                above = true

            if (RSI < BUYVALUE)  // Checks if the RSI value is lesser than the buy value.
                below = true

            CPrint(`SELLVALUE == ${SELLVALUE}`)
            CPrint(`above == ${above}`)
            CPrint(`BUYVALUE == ${BUYVALUE}`)
            CPrint(`below == ${below}`)


            if (RSI <= SELLVALUE && RSI >= BUYVALUE) {
                if (above) {

                    BigStyleText("SELLING");
                    const COINQuantity = (await GetQuantity()) | 0
                    const price = await GetCurrentPrice('ask')
                    if (COINQuantity)
                        await Trade('sell', COINQuantity, price)
                    above = false
                    SaveRSIToDB({ value: RSI, price, qty: COINQuantity, action: "sell" })
                }
                if (below) {

                    BigStyleText("BUYING");
                    const INRQuantity = await GetQuantity(2, "INR")
                    const price = await GetCurrentPrice('bid')
                    const CoinToBuy = (INRQuantity / price) | 0
                    if (CoinToBuy)
                        await Trade('buy', CoinToBuy, price)
                    below = false
                    SaveRSIToDB({ value: RSI, price, qty: CoinToBuy, action: "buy" })
                }

            }
            await loader();
        } catch (error) {
            console.log(error)
        }
    }
})();

const fs = require("fs");
const url = require("url");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const querystring = require("querystring");
const CloseEmitter = require("./module/CloseEmitter.js");

const { client_id, client_secret } = require("./auth/credentials.json");

const all_sessions = [];
const port = 3000;

const server = http.createServer();

server.on("listening", () => {
    console.log(`Now Listening on Port ${port}`);
});
server.listen(port);

server.on("request", request_handler);

function request_handler(req, res) {
    console.log(`New Request From ${req.socket.remoteAddress} for ${req.url}`);
    const redirect_uri = `http://${req.headers.host}/auth`;

    // route for pipe the form.html to the root page
    if (req.url === "/") {
        const form = fs.createReadStream("html/form.html");
        res.writeHead(200, { Content_Type: "text/html" });
        form.pipe(res);
    }
    // route for collect user input
    else if (req.url.startsWith("/search")) {
        const { keyword } = url.parse(req.url, true).query;
        if ((keyword == null) | (keyword == "")) {
            error_status(res, 400, "Bad Request", "Empty Search");
            return;
        }
        const state = crypto.randomBytes(20).toString("hex");
        all_sessions.push({ keyword, state });

        // request the food recipes by using the user input keyword
        get_food_recipes(keyword, state, redirect_uri, res);
    }
    // route for receive authorization code after user granted permission
    else if (req.url.startsWith("/auth")) {
        const { code, state } = url.parse(req.url, true).query;
        const session = all_sessions.find((session) => session.state === state);
        if (
            code === undefined ||
            state === undefined ||
            session === undefined
        ) {
            error_status(res, 401, "Unauthorized", "Authorization Denial");
            return;
        }
        // exchange the code for access token
        request_access_token(code, res, redirect_uri, session);
    }
    // 404 Not Found
    else {
        error_status(res, 404, "Not Found", "Page Does Not Exist");
    }
}

// clear the token cache when the server close
const close_emitter = new CloseEmitter();
close_emitter.on("close", () => {
    fs.unlink("./cache/token.json", () => {});
    process.exit();
});

// -----------------------Request Food Recipes from TheMealDB--------------------------

function get_food_recipes(keyword, state, redirect_uri, res) {
    const endpoint = `https://www.themealdb.com/api/json/v1/1/search.php?s=${keyword}`;
    https
        .request(endpoint, { method: "GET" }, (recipes_stream) => {
            process_stream(
                recipes_stream,
                receive_food_recipes,
                keyword,
                state,
                redirect_uri,
                res
            );
        })
        .end();
}

function receive_food_recipes(body, keyword, state, redirect_uri, res) {
    const { meals } = JSON.parse(body);
    if (meals == null) {
        // no search result
        error_status(res, 404, "Not Found", "No Items Match Your Search");
        return;
    }

    // obtain info that we need for creating the recipes
    const food_recipes = [];
    meals.forEach((meal) => {
        // integrate the measurement and ingredients
        let ingre = getValsByKeys(meal, "strIngredient");
        let measure = getValsByKeys(meal, "strMeasure");
        let strIngre = combine_arr_to_str(measure, ingre);
        // convert the long string to an array by newline (the block of notion page has length limitation)
        let arrInstructions = meal.strInstructions.split("\r\n");
        let recipe = {
            name: meal.strMeal,
            ingredients: strIngre,
            instructions: arrInstructions,
            image: meal.strMealThumb,
            video: meal.strYoutube,
        };
        food_recipes.push(recipe);
    });

    // save food_recipes into current session of all_sessions array
    const index = all_sessions.findIndex((session) => session.state === state);
    all_sessions[index].food_recipes = food_recipes;

    // if we have available token, skip the authentication of Notion API
    // if not, redirect to Notion Authentication
    fs.readFile("./cache/token.json", { encoding: "utf-8" }, (err, data) => {
        if (err) {
            redirect_to_Notion_auth(state, redirect_uri, res);
        } else {
            const { access_token } = JSON.parse(data);
            create_keyword_page(access_token, food_recipes, keyword, res);
        }
    });
}

// ---------------Notion OAuth 2.0 Three Legged Authentication------------------

function redirect_to_Notion_auth(state, redirect_uri, res) {
    const auth_endpoint = "https://api.notion.com/v1/oauth/authorize";
    const authQuery = {
        client_id: client_id,
        redirect_uri: redirect_uri,
        response_type: "code",
        owner: "user",
        state: state,
    };
    let queryParams = querystring.stringify(authQuery);
    res.writeHead(302, { Location: `${auth_endpoint}?${queryParams}` }).end();
}

function request_access_token(authCode, res, redirectUri, session) {
    const token_endpoint = "https://api.notion.com/v1/oauth/token";
    const post_data = JSON.stringify({
        grant_type: "authorization_code",
        code: authCode,
        redirect_uri: redirectUri,
    });
    let auth_base64 = Buffer.from(`${client_id}:${client_secret}`).toString(
        "base64"
    );
    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${auth_base64}`,
        },
    };
    https
        .request(token_endpoint, options, (token_stream) => {
            process_stream(token_stream, receive_access_token, session, res);
        })
        .end(post_data);
}

function receive_access_token(body, session, res) {
    const { access_token } = JSON.parse(body);
    if (access_token === undefined) {
        // when received error info
        error_status(res, 401, "Unauthorized", "Failed to Get Access Token");
        return;
    }
    fs.writeFile("./cache/token.json", body, (err) => {}); // cache the token for further requests
    create_keyword_page(
        access_token,
        session.food_recipes,
        session.keyword,
        res
    );
}

// ------------------Create Food Recipes on Notion------------------------

function create_keyword_page(token, food_recipes, keyword, res) {
    const keyword_form = require("./workpages/keyword_page.json"); // require calls are cached, consecutive calls will return the same object
    const keyword_page = JSON.parse(JSON.stringify(keyword_form)); // make a deep copy of the keyword_form
    keyword_page.properties.title[0] = { text: { content: `${keyword}` } };
    const post_data = JSON.stringify(keyword_page);
    let recipe_count = 0;
    create_notion_page(
        token,
        post_data,
        add_recipes,
        food_recipes,
        recipe_count,
        res
    );
}

function add_recipes(body, token, food_recipes, count, res) {
    const parent_page = JSON.parse(body);
    if (parent_page.object === "error") {
        error_status(res, 400, "Bad Request", "Failed to Create Keyword Page");
        return;
    }
    process_recipe(parent_page, token, food_recipes, count, res);
}

function process_recipe(parent_page, token, food_recipes, count, res) {
    const parent_id = parent_page.id;
    const recipe = food_recipes[count];

    // create recipe page inside the keyword page for each recipe
    const recipe_form = require("./workpages/recipe_page.json"); // require calls are cached, consecutive calls will return the same object
    const recipe_page = JSON.parse(JSON.stringify(recipe_form)); // make a deep copy of the recipe_form

    // setting params for the page
    recipe_page.parent.page_id = parent_id;
    recipe_page.properties.title[0] = { text: { content: `${recipe.name}` } };
    recipe_page.children[3].paragraph.rich_text[0] = {
        text: { content: recipe.ingredients },
    };

    recipe.instructions.forEach((instruction) => {
        recipe_page.children.push({
            paragraph: {
                rich_text: [{ text: { content: `${instruction}` } }],
            },
        });
    });

    // if image url is not provided, remove "cover"
    if (recipe.image.startsWith("http")) {
        recipe_page.cover.external.url = recipe.image;
    } else {
        delete recipe_page.cover;
    }
    // if video url is not provided, remove first 2 element of children
    if (recipe.video.startsWith("http")) {
        recipe_page.children[1].video.external.url = recipe.video;
    } else {
        recipe_page.children.splice(0, 2); // remove the first 2 elements from children
    }

    const post_data = JSON.stringify(recipe_page);
    create_notion_page(
        token,
        post_data,
        wait_for_page_response,
        parent_page,
        food_recipes,
        count,
        res
    );
}

function wait_for_page_response(
    body,
    token,
    parent_page,
    food_recipes,
    count,
    res
) {
    count++;
    if (count == food_recipes.length) {
        res.writeHead(302, { Location: parent_page.url }).end();
    } else {
        process_recipe(parent_page, token, food_recipes, count, res);
    }
}

// ---------------------Reusable Assistant Function------------------------

// used when there's error or the user visit the page that does not exist
function error_status(res, status_code, status, info) {
    res.writeHead(status_code, { Content_Type: "text/html" });
    res.write(`<h1>${status_code} ${status}</h1>`);
    res.end(`<p>${info}</p>`);
}

function process_stream(stream, callback, ...args) {
    let body = "";
    stream.on("data", (chunk) => (body += chunk));
    stream.on("end", () => callback(body, ...args));
}

function create_notion_page(token, post_data, callback, ...args) {
    const page_endpoint = "https://api.notion.com/v1/pages";
    const options = {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
        },
    };
    https
        .request(page_endpoint, options, (page_stream) => {
            process_stream(page_stream, callback, token, ...args);
        })
        .end(post_data);
}

// get all values that the keys name starts with a specific pattern, return as array
function getValsByKeys(pairArr, pattern) {
    const vals = [];
    for (key in pairArr) {
        if (pairArr[key] === "" || pairArr[key] === " ") {
            continue;
        }
        if (key.toString().startsWith(pattern)) {
            vals.push(pairArr[key]);
        }
    }
    return vals;
}

// combine elements of two arrays to strings in index order
function combine_arr_to_str(arr1, arr2) {
    let str = "";
    for (let i = 0; i < arr1.length; i++) {
        str += `${arr1[i]} ${arr2[i]}\r\n`;
    }
    return str;
}

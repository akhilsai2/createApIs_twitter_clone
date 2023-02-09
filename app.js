const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("Server is running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error:${e.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

//Register the new user in user
app.post("/register", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const userExists = `SELECT * FROM user WHERE username='${username}';`;
  const user = await db.get(userExists);
  if (user != undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const addUser = `INSERT INTO user (username,password,name,gender)
            VALUES ('${username}','${hashedPassword}','${name}','${gender}');`;
      await db.run(addUser);
      response.send("User created successfully");
    }
  }
});

//Login with existing user
app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const userExists = `SELECT * FROM user WHERE username='${username}';`;
  const user = await db.get(userExists);
  //console.log(user);
  if (user != undefined) {
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (isPasswordMatch === true) {
      const payload = { username: user.username };
      const jwtToken = jwt.sign(payload, "MY_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

const authenticationToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader != undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid jwt Token");
  } else {
    jwt.verify(jwtToken, "MY_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid jwt Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//Returns the latest tweets of people whom the user
// follows. Return 4 tweets at a time

app.get("/user/tweets/feed", authenticationToken, async (request, response) => {
  const { username } = request;

  const getFeed = `
    SELECT
     user.username,tweet.tweet,tweet.date_time
    FROM 
    follower 
    LEFT JOIN tweet ON follower.following_user_id = tweet.user_id
    LEFT JOIN user ON user.user_id=follower.following_user_id 
    WHERE follower.follower_user_id=(SELECT user_id FROM user WHERE username='${username}')
    ORDER BY tweet.date_time DESC
    LIMIT 4;
    `;
  const feeds = await db.all(getFeed);
  response.send(
    feeds.map((each) => {
      return {
        username: each.username,
        tweet: each.tweet,
        dateTime: each.date_time,
      };
    })
  );
});

//user following
app.get("/user/following", authenticationToken, async (request, response) => {
  const { username } = request;
  const getUserFollowing = `SELECT user.name FROM follower 
  LEFT JOIN user ON follower.following_user_id=user.user_id WHERE follower.follower_user_id=(SELECT user_id FROM user WHERE username='${username}');`;
  const following = await db.all(getUserFollowing);
  response.send(following);
});

//user follower
app.get("/user/follower", authenticationToken, async (request, response) => {
  const { username } = request;
  const getUserFollower = `SELECT user.name FROM follower 
    LEFT JOIN user ON follower.follower_user_id=user.user_id 
    WHERE follower.following_user_id=(SELECT user_id FROM user WHERE username='${username}');`;
  const follower = await db.all(getUserFollower);
  response.send(follower);
});

const follow = (request, response, next) => {
  const { tweetId } = request.params;
  const { username } = request;
  const isFollowing = `SELECT * FROM follower WHERE 
       follower_user_id =(SELECT user_id FROM user WHERE username='${username}') AND
       following_user_id=(SELECT user.user_id FROM tweet NATURAL JOIN user WHERE tweet_id=${tweetId});`;
  const followUser = db.get(isFollowing);
  if (followUser === undefined) {
    response.status(400);
    response.send("Invalid Request");
  } else {
    next();
  }
};
//tweet by respective tweet ID
app.get(
  "/tweet/:tweetId",
  authenticationToken,
  follow,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const tweetUser = `SELECT tweet,date_time,COUNT(like_id) AS likes,COUNT(reply_id) AS replies FROM tweet NATURAL JOIN like NATURAL JOIN reply WHERE tweet_id=${tweetId};`;
    const tweet = await db.get(tweetUser);
    response.send(tweet);
  }
);

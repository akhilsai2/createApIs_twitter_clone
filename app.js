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
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
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
app.get("/user/followers", authenticationToken, async (request, response) => {
  const { username } = request;
  const getUserFollower = `SELECT user.name FROM follower 
    LEFT JOIN user ON follower.follower_user_id=user.user_id 
    WHERE follower.following_user_id=(SELECT user_id FROM user WHERE username='${username}');`;
  const follower = await db.all(getUserFollower);
  response.send(follower);
});

const follow = async (request, response, next) => {
  const { tweetId } = request.params;
  const { username } = request;
  const isFollowing = `SELECT * FROM follower WHERE 
       follower_user_id =(SELECT user_id FROM user WHERE username='${username}') AND
       following_user_id=(SELECT user.user_id FROM tweet NATURAL JOIN user WHERE tweet_id=${tweetId});`;
  const followUser = await db.get(isFollowing);
  if (followUser === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};
//tweet by respective tweet ID
app.get(
  "/tweets/:tweetId",
  authenticationToken,
  follow,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const tweetUser = `SELECT tweet,date_time FROM tweet WHERE tweet_id=${tweetId};`;
    const likeUser = `SELECT COUNT(like_id) AS likes FROM like WHERE tweet_id=${tweetId};`;
    const replyUser = `SELECT COUNT(reply_id) AS replies FROM reply WHERE tweet_id=${tweetId};`;
    const userTweet = await db.get(tweetUser);
    const { tweet, date_time } = userTweet;
    const userLikes = await db.get(likeUser);
    const { likes } = userLikes;
    const userReplies = await db.get(replyUser);
    const { replies } = userReplies;

    response.send({
      tweet,

      likes,
      replies,
      dateTime: userTweet.date_time,
    });
  }
);

//tweet of tweetId LIKES
app.get(
  "/tweets/:tweetId/likes",
  authenticationToken,
  follow,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const likedName = `SELECT user.username FROM like NATURAL JOIN user WHERE tweet_id=${tweetId};`;
    const names = await db.all(likedName);

    response.send({ likes: names.map((item) => item.username) });
  }
);

//get all the tweet by the logged user
app.get("/user/tweets/", authenticationToken, async (request, response) => {
  const { username } = request;
  const myTweet = `SELECT tweet.tweet,COUNT(distinct like.like_id) AS likes,
    COUNT(distinct reply.reply_id) AS replies,tweet.date_time FROM tweet 
    LEFT JOIN like ON tweet.tweet_id=like.tweet_id
    LEFT JOIN reply ON tweet.tweet_id=reply.tweet_id
    WHERE tweet.user_id=(SELECT user_id FROM user WHERE username='${username}')
    GROUP BY tweet.tweet_id;`;
  const userReply = await db.all(myTweet);
  response.send(
    userReply.map((item) => {
      const { date_time, ...rest } = item;
      return {
        ...rest,
        dateTime: date_time,
      };
    })
  );
});

//post a tweet by the logged in user
app.get(
  "/tweets/:tweetId/replies/",
  authenticationToken,
  follow,
  async (request, response) => {
    const { tweetId } = request.params;
    const userReply = `SELECT user.name,reply.reply FROM reply NATURAL JOIN user WHERE tweet_id=${tweetId};`;
    const replies = await db.all(userReply);
    response.send({ replies });
  }
);

//post a tweet by logged in user
app.post("/user/tweets/", authenticationToken, async (request, response) => {
  const { tweet } = request.body;
  const { username } = request;
  const getUser = `SELECT user_id FROM user WHERE username='${username}';`;
  const user = await db.get(getUser);
  const { user_id } = user;
  const addUser = `INSERT INTO tweet (tweet,user_id)
    VALUES ('${tweet}',${user_id});`;
  await db.run(addUser);
  response.send("Created a Tweet");
});
// delete a tweet
app.delete(
  "/tweets/:tweetId/",
  authenticationToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const userTweet = `SELECT tweet_id,user_id FROM tweet WHERE tweet_id=${tweetId} AND user_id=(SELECT user_id FROM user WHERE username='${username}');`;
    const tweetResult = await db.get(userTweet);
    // console.log(tweetResult);
    if (tweetResult === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweet = `DELETE FROM tweet WHERE tweet_id=${tweetId};`;
      await db.run(deleteTweet);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;

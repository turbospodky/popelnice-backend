const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.urlencoded({extended: true}));
app.use(express.json());

const db = mysql.createConnection({
    user: 'root',
    host: 'localhost',
    password: 'medved',
    database: 'db_test'
})








//
//AUTH
//

let activeSessions = [];

function generateToken () {
    return Math.random().toString(36).substr(2) + Math.random().toString(36).substr(2);
}

function login(username, townPrefix, isAdmin) {
    //generate token
    let token;
    let tokenReady = false;
    while (!tokenReady) {
        token = generateToken();
        tokenReady = true;
        for (let i = 0; i < activeSessions.length; i++) {
            if (activeSessions[i].token == token) {
                tokenReady = false;
                break;
            }
        }
    }

    activeSessions.push({
        token: token,
        username: username,
        townPrefix: townPrefix,
        isAdmin: isAdmin,
        created: Date.now()
    });

    return token;
}

app.get('/sessions', (req, res) => {
    console.log(activeSessions);
    res.send(activeSessions);
});








//
//AUTH API
//

app.post('/login', (req, res) => {
    const username = req.body.username;
    const password = req.body.password;

    db.query(
        'SELECT * FROM users WHERE username = ? AND password = ?',
        [username, password],
        (err, rows, fields) => {
            if (err) {
                console.log(err);
            }

            if (rows.length != 0) {
                const user = rows[0];
                const token = login(user.username, user.townPrefix, user.isAdmin);
                res.send({
                    token: token,
                    isAdmin: user.isAdmin
                });
            } else {
                res.sendStatus(403);
            }           
        }
    );
});

app.post('/verifyToken', (req, res) => {
    const tokenToVerify = req.body.token;
    console.log('verifying ' + tokenToVerify);
    for (let i = 0; i < activeSessions.length; i++) {
        if (tokenToVerify == activeSessions[i].token) {
            res.send({
                isAdmin: !!activeSessions[i].isAdmin
            });
            return;
        }
    }
    res.sendStatus(403);
});








//
//DATA FETCHING FUNCTIONALITY
//

async function getTable (townPrefix, tableName) {
    return new Promise((resolve, reject) => {
        db.query(
            'SELECT * FROM ' + townPrefix + '__' + tableName,
            function (err, result) {
                if (err) reject(err);
                resolve(result);
            }
        );
    });
}

async function getRecordsByCount (townPrefix, containerId, count) {
    return new Promise((resolve, reject) => {
        db.query(
            'SELECT *, TIMESTAMPDIFF(MINUTE, record_datetime, NOW()) / 1440 AS difference_days FROM ' + townPrefix + '__records WHERE container_id = ? ORDER BY record_datetime DESC LIMIT ?',
            [containerId, count],
            function (err, result) {
                if (err) reject(err);
                resolve(result);
            }
        );
    });
}







//
//GET DATA API
//

app.post('/getTownData', async (req, res) => {
    const token = req.body.token;
    if (!token) {
        res.sendStatus(402);
        return;
    }

    //v tyhlety casti, kdy se dostanu k dany sessione mozna zjistit, jestli uz neni porosla eeno
    let session = null;
    for (let i = 0; i < activeSessions.length; i++) {
        if (token == activeSessions[i].token) {
            session = activeSessions[i];
            break;
        }
    }
    if (!session) {
        res.sendStatus(403);
        res.send('prihlaseni vyprselo');
        return;
    }


    let returnServerError = false;

    const wasteTypes = await getTable(session.townPrefix, 'wastetypes')
    .catch((err) => {
        console.log(err);
        returnServerError = true;
    });

    const sites = await getTable(session.townPrefix, 'sites')
    .catch((err) => {
        console.log(err);
        returnServerError = true;
    });

    const containers = await getTable(session.townPrefix, 'containers')
    .catch((err) => {
        console.log(err);
        returnServerError = true;
    });

    if (returnServerError) {
        res.sendStatus(500);
        return;
    }

    for (let i = 0; i < containers.length; i++) {
        let latestRecord = await getRecordsByCount(session.townPrefix, containers[i].id, 1)
        .catch((err) => {
            console.log(err);
            returnServerError = true;
        });

        if (returnServerError) {
            res.sendStatus(500);
            return;
        }

        latestRecord = latestRecord[0];
        containers[i].fill = Math.round(latestRecord.fill * 100) / 100;
        containers[i].blocked = latestRecord.blocked;
        containers[i].baterry = latestRecord.baterry;
        containers[i].daysSinceUpdated = latestRecord.difference_days;
        containers[i].type = 0;
        containers[i].typeName = 'default waste type';
        for (let j = 0; j < wasteTypes.length; j++) {
            if (containers[i].type_id == wasteTypes[j].id) {
                containers[i].type = wasteTypes[j].type;
                containers[i].typeName = wasteTypes[j].name;
            }
        }
    }

    for (let i = 0; i < containers.length; i++) {
        for (let j = 0; j < sites.length; j++) {
            if (containers[i].site_id == sites[j].id) {
                if (sites[j].containers === undefined) {
                    sites[j].containers = [];
                }
                sites[j].containers.push(containers[i]);
            }
        }
    }

    let result = {
        wasteTypes: wasteTypes,
        sites: sites
    }
    
    res.send(result);
});




app.get('/getRecords/:id/count/:limit', (req, res) => {

    const id = parseInt(req.params.id);
    const limit = parseInt(req.params.limit);

    db.query(
        'SELECT *, TIMESTAMPDIFF(MINUTE, record_datetime, NOW()) / 1440 AS difference_days FROM jicin__records WHERE container_id = ? ORDER BY record_datetime DESC LIMIT ?',
        [id, limit],
        (err, result) => {
            if (err) {
                console.log(err);
            }

            res.send(result);
        }
    );
});

app.get('/getRecords/:id/days/:days', (req, res) => {

    const id = parseInt(req.params.id);
    const days = parseInt(req.params.days);
    
    db.query(
        'SELECT *, TIMESTAMPDIFF(MINUTE, record_datetime, NOW()) / 1440 AS difference_days, DATE_FORMAT(record_datetime, \'%e. %c. %Y\') AS record_datetime_formated FROM jicin__records WHERE container_id = ? HAVING difference_days <= ? ORDER BY record_datetime DESC',
        [id, days],
        (err, result) => {
            if (err) {
                console.log(err);
            }
            
            res.send(result);
        }
    );
});

app.get('/getSites', (req, res) => {
    db.query(
        'SELECT * FROM jicin__sites',
        (err, result) => {
            if (err) {
                console.log(err);
            }

            res.send(result);
        }
    );
});

app.get('/getContainers', (req, res) => {
    db.query(
        'SELECT * FROM jicin__containers',
        (err, result) => {
            if (err) {
                console.log(err);
            }

            res.send(result);
        }
    );
});

app.get('/getWasteTypes', (req, res) => {
    db.query(
        'SELECT * FROM jicin__wastetypes',
        (err, result) => {
            if (err) {
                console.log(err);
            }

            res.send(result);
        }
    );
});




app.listen(3001, () => {
    console.log('backend server running on localhost:3001');
});
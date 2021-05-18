const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const bcrypt = require('bcrypt');
const schedule = require('node-schedule');
const app = express();

const saltRounds = 10;
const tokenLength = 150;
const sessionLifeLength = 3600;

app.use(cors());
app.use(express.urlencoded({extended: true}));
app.use(express.json());

const db = mysql.createConnection({
    user: 'root',
    host: 'localhost',
    password: 'medved',
    database: 'db_test'
})

const clearOldSessionsJob = schedule.scheduleJob('01 * * * *', function() {
    clearOldSessions();
});








//
//AUTH
//

let activeSessions = [];

function getSession(token) {
    for (let i = 0; i < activeSessions.length; i++) {
        if (token == activeSessions[i].token) {
            return activeSessions[i];
        }
    }
    return null;
}

function deleteSession(token) {
    let newActiveSessions = [];
    let deleted = false;
    for (let i = 0; i < activeSessions.length; i++) {
        if (token != activeSessions[i].token) {
            newActiveSessions.push(activeSessions[i]);
        } else {
            deleted = true;
        }
    }
    activeSessions = newActiveSessions;
    return deleted;
}

function generateToken () {
    let token = '';
    for (let i = 0; i < tokenLength; i++) {
        token += Math.random().toString(36).substr(2);
    }
    return token;
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
        isAdmin: !!isAdmin,
        created: Date.now()
    });

    return token;
}

function clearOldSessions() {
    for (let i = 0; i < activeSessions.length; i++) {
        const secondsSinceCreated = (Date.now() - activeSessions[i].created) / 1000;
        if (secondsSinceCreated > sessionLifeLength) {
            deleteSession(activeSessions[i].token);
        }
    }
}

app.get('/sessions', (req, res) => {
    res.send(activeSessions);
});

async function encryptPassword(plainTextPassword) {
    const encrypted = await bcrypt.hash(plainTextPassword, saltRounds);
    console.log(plainTextPassword + '=>' + encrypted);
}








//
//AUTH API
//

app.post('/login', (req, res) => {
    const username = req.body.username;
    const password = req.body.password;

    db.query(
        'SELECT * FROM users WHERE username = ?',
        [username],
        (err, rows, fields) => {
            if (err) {
                console.log(err);
            }

            if (rows.length != 0) {
                const user = rows[0];
                bcrypt.compare(password, user.password, function(err, result) {
                    if (result) {
                        const token = login(user.username, user.townPrefix, user.isAdmin);
                        res.send({
                            token: token,
                            isAdmin: user.isAdmin
                        });
                    } else {
                        res.sendStatus(403);
                    } 
                });
            } else {
                res.sendStatus(403);
            }         
        }
    );
});

app.post('/logout', (req, res) => {
    const token = req.body.token;
    const deleted = deleteSession(token);
    if (deleted) {
        res.sendStatus(200);
    } else {
        res.sendStatus(403);
    }
});

app.post('/verifyToken', (req, res) => {
    const tokenToVerify = req.body.token;
    for (let i = 0; i < activeSessions.length; i++) {
        if (tokenToVerify == activeSessions[i].token) {
            activeSessions[i].created = Date.now();
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
//API
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
        delete containers[i].key;
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

app.post('/averageFillTimePerType', (req, res) => {
    const token = req.body.token;
    const session = getSession(token);
    if (session === null) {
        res.sendStatus(403);
        return;
    }

    const townPrefix = session.townPrefix;
    const sites = req.body.sites;
    const days = req.body.time;

    let sqlSiteRestriction = '';
    let sqlTimeRestriction = '';
    if (typeof(sites) == 'number') {
        sqlSiteRestriction = ' AND site_id = '+sites;
    }
    if (days != 0) {
        sqlTimeRestriction = ' WHERE TIMESTAMPDIFF(DAY, record_datetime, NOW()) < '+days;
    }

    db.query(
        'SELECT type_id, container_id, fill, TIMESTAMPDIFF(HOUR, record_datetime, NOW()) AS hours_passed'+
        ' FROM '+townPrefix+'__records'+
        ' INNER JOIN '+townPrefix+'__containers ON '+townPrefix+'__records.container_id = '+townPrefix+'__containers.id'+
        sqlTimeRestriction+
        sqlSiteRestriction+
        ' ORDER BY type_id, container_id, record_datetime',
        [],
        (err, result) => {
            if (err) {
                console.log(err);
                res.sendStatus(500);
            } else {
                let usedContainerIds = [];
                let containerHistories = []; //[container_id => {type: 1, avg: 5},...]

                result.forEach(record => {
                    const containerId = record.container_id;

                    if (!usedContainerIds.includes(containerId)) {
                        usedContainerIds.push(containerId);
                        containerHistories[containerId] = {
                            type: record.type_id,
                            history: []
                        };
                    }

                    containerHistories[containerId].history.push({
                        fill: record.fill,
                        hoursPassed: record.hours_passed,
                        daysFromPreviousRecord: 0,
                        fillDifference: 0
                    });

                    let lastHistoryIndex = containerHistories[containerId].history.length - 1;
                    if (lastHistoryIndex > 0) {
                        const history = containerHistories[containerId].history;

                        const daysFromPreviousRecord = (history[lastHistoryIndex - 1].hoursPassed - history[lastHistoryIndex].hoursPassed)/24;
                        let fillDifference = history[lastHistoryIndex].fill - history[lastHistoryIndex - 1].fill;
                        if (fillDifference <= -0.3) { //-30% is just a random temporary value to detect an emptying until an ideal one is measured
                            fillDifference = history[lastHistoryIndex].fill;
                        }


                        containerHistories[containerId].history[lastHistoryIndex].daysFromPreviousRecord = daysFromPreviousRecord;
                        containerHistories[containerId].history[lastHistoryIndex].fillDifference = fillDifference;
                    }
                });

                let usedTypeIds = [];
                let typeAverages = [];

                containerHistories.forEach(containerHistory => {
                    const typeId = containerHistory.type;

                    if (!usedTypeIds.includes(typeId)) {
                        usedTypeIds.push(typeId);
                        typeAverages[typeId] = {
                            fillSum: 0,
                            daysSum: 0
                        };
                    }

                    containerHistory.history.forEach(record => {
                        typeAverages[typeId].fillSum += record.fillDifference;
                        typeAverages[typeId].daysSum += record.daysFromPreviousRecord;
                    });
                });

                let response = [];
                usedTypeIds.forEach(typeId => {
                    const fillSum = typeAverages[typeId].fillSum;
                    const daysSum = typeAverages[typeId].daysSum;
                    
                    const averageDaysToFill = fillSum == 0 ? 0 : daysSum/fillSum;

                    response.push({
                        typeId: typeId,
                        daysToFill: averageDaysToFill
                    });
                });

                res.send(response);
            }
        }
    );
});

app.post('/renameSite', (req, res) => {
    const token = req.body.token;
    const siteId = req.body.siteId;
    const newName = req.body.newName;

    const session = getSession(token);

    if (!newName || newName == '') {
        res.sendStatus(500); //nepodařilo se provést změny
        return;
    }

    if (session && session.isAdmin) {
        const townPrefix = session.townPrefix;
        console.log(newName);
        db.query(
            'UPDATE '+townPrefix+'__sites SET name = \''+newName+'\' WHERE id = ?',
            [siteId],
            (err) => {
                if (err) {
                    res.sendStatus(500);
                } else {
                    res.sendStatus(200);
                }
            }
        );
    } else {
        res.sendStatus(403);
    }
});

app.put('/newRecord', (req, res) => {
    const townPrefix = req.body.town;
    const containerId = req.body.containerId;
    const containerKey = req.body.containerKey;

    const dateTime = req.body.record.dateTime;
    const fill = req.body.record.fill;
    const baterry = req.body.record.baterry;
    const blocked = req.body.record.blocked;
    
    db.query(
        'SELECT * FROM '+townPrefix+'__containers WHERE id = ?',
        [containerId],
        (err, result) => {
            if (err) {
                console.log(err);
                res.sendStatus(400);
            } else {
                console.log('comparing', containerKey, result[0]);
                bcrypt.compare(containerKey, result[0].key, function(err, result) {
                    if (result) {

                        //put the record in the database
                        db.query('INSERT INTO '+townPrefix+'__records (container_id, record_datetime, fill, baterry, blocked) VALUES ( ?, ?, ?, ?, ?)',
                        [containerId, dateTime, fill, baterry, blocked],
                        (err, result) => {
                            if (err) {
                                console.log(err),
                                res.sendStatus(500);
                            } else {
                                res.sendStatus(200);
                                //maybe notify logged-in clients
                            }
                        });

                    } else {
                        res.sendStatus(403);
                    } 
                });
            }
        }
    );
});






app.listen(3001, () => {
    console.log('backend server running on localhost:3001');
});
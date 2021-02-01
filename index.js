const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const app = express();

app.use(cors());


//
//CONNECT TO DB
//


const db = mysql.createConnection({
    user: 'root',
    host: 'localhost',
    password: 'medved',
    database: 'db_test'
})


//
//API
//


//
//INSERT DATA API
//


app.post('/insert', (req, res) => {

    const variableToInsert1 = 'something';
    const variableToInsert2 = 'something';

    db.query(
        'SQL INSERT statement ? = var1 ? = var2',
        [variableToInsert1, variableToInsert2],
        (err, result) => {
            if (err) {
                console.log(err);
            }

            res.send(result);
        }
    );
});


//
//GET DATA API
//

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
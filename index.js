const express = require('express')
const app = express()


const cors = require('cors');
require('dotenv').config();


const stripe = require('stripe')(process.env.STRIPE_SECRET);



const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');



const port = process.env.PORT || 3000;


var admin = require("firebase-admin");


const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


const crypto = require('crypto');


function generateTrackingId() {
    const prefix = 'PRCL';
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${prefix}-${date}-${random}`;
}

//middle
app.use(express.json())
app.use(cors())
//middle 2

const verifyFBToken = async (req, res, next) => {
    console.log('header from middle= ', req.headers.authorization)

    const token = req.headers.authorization;


    if (!token) {
        return res.status(401).send({ message: 'unauthorize access' })
    }

    try {
        const tokenId = token.split(' ')[1]
        const decoded = await admin.auth().verifyIdToken(tokenId)
        console.log('decoded in token', decoded)

        req.decodedEmail = decoded.email
        next()
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorize access' })
    }

}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@simple-curd-server.rjfvned.mongodb.net/?appName=simple-curd-server`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});



async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        console.log("MongoDB connected successfully");


        const db = client.db("StyleDecoreProject")
        const serviceCollection = db.collection('services')
        const userCollection = db.collection('users')
        const bookingCollection = db.collection('bookings')
        const paymentCollection = db.collection('payments')
        const decoratorCollection = db.collection('decorators')
        const trackingsCollection = db.collection('trackings')
        //middle 3
        const verifyAdmin = async (req, res, next) => {
            const email = req.decodedEmail;

            const query = { email }
            const user = await userCollection.findOne(query)

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next()
        }


        //function

        const logTracking = async (trackingId, status) => {
            const log = {
                trackingId,
                status,
                details: status.split('_').join(' '),
                createdAt: new Date()
            }
            const result = await trackingsCollection.insertOne(log)
            return result;
        }


        //traking related api
        app.get('/trackings/:trackingId/logs', async (req, res) => {
            const trackingId = req.params.trackingId;
            const query = { trackingId };
            const result = await trackingsCollection.find(query).toArray();
            res.send(result)

        })
        //decorators

        app.post('/decorators', async (req, res) => {
            try {
                const decorator = req.body;
                const email = decorator.decoratorEmail;

                if (!email) {
                    return res.status(400).send({ message: 'Email is required.' });
                }

                const existingDecorator = await decoratorCollection.findOne({ decoratorEmail: email });

                if (existingDecorator) {
                    return res.status(409).send({
                        message: 'You have already submitted a decorator application.',
                        status: existingDecorator.status
                    });
                }

                decorator.status = 'pending';
                decorator.createdAt = new Date();

                const result = await decoratorCollection.insertOne(decorator);

                res.status(201).send({
                    message: 'Decorator application submitted successfully.',
                    insertedId: result.insertedId
                });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });



        app.get('/decorators', async (req, res) => {

            const { status, workStatus, district } = req.query;

            const query = {};
            const options = { sort: { createdAt: -1 } }

            if (status) {
                query.status = status;
            }
            if (workStatus) {
                query.workStatus = workStatus;
            }
            if (district) {
                query.district = district;
            }
            const cursor = decoratorCollection.find(query, options)
            const result = await cursor.toArray();
            res.send(result)
        })
        app.patch('/decorators/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const status = req.body.status;
            const updatedDoc = {
                $set: {
                    status: status,
                    workStatus: 'available'
                }
            }
            const result = await decoratorCollection.updateOne(query, updatedDoc);



            if (status === 'approved') {
                const email = req.body.email;
                const userQuery = { email }
                const updateUser = {
                    $set: {
                        role: 'decorator'
                    }
                }
                const userResult = await userCollection.updateOne(userQuery, updateUser)
            }
            res.send(result);
        })
        app.delete('/decorators/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const result = await decoratorCollection.deleteOne(query);
            res.send(result);
        });
        //booking API
        app.post('/bookings', async (req, res) => {
            const booking = req.body
            const trackingId = generateTrackingId()

            booking.createdAt = new Date()

            booking.trackingId = trackingId

            logTracking(trackingId, 'booking_created');
            const result = await bookingCollection.insertOne(booking)
            res.send(result)

        })

        app.get('/bookings', async (req, res) => {
            const query = {}
            const { email, bookingStatus } = req.query

            if (bookingStatus) {
                query.bookingStatus = bookingStatus;
            }
            if (email) {
                query.userEmail = email;
            }
            const options = { sort: { createdAt: -1 } }

            const cursor = bookingCollection.find(query, options)
            const result = await cursor.toArray()
            res.send(result)
        })

        app.get('/allBookings', async (req, res) => {

            const page = parseInt(req.query.page) || 1;
            const size = parseInt(req.query.size) || 5;


            const query = {}
            const options = { sort: { createdAt: -1 } }

            const cursor = bookingCollection.find(query, options).skip((page - 1) * size)
                .limit(size)

            const result = await cursor.toArray()
            res.send(result)
        })
        app.get('/allBookingsCount', async (req, res) => {
            const count = await bookingCollection.countDocuments();
            res.send({ count });
        });


        app.get('/bookings/decorator', async (req, res) => {
            const { decoratorEmail, bookingStatus } = req.query;

            const query = {}

            if (decoratorEmail) {
                query.decoratorEmail = decoratorEmail
            }
            if (bookingStatus) {
                query.bookingStatus = bookingStatus
                query.bookingStatus = { $nin: ['Completed'] }
            }

            else {
                query.bookingStatus = bookingStatus
            }
            const cursor = bookingCollection.find(query)
            const result = await cursor.toArray();
            res.send(result);

        })
        app.get('/bookings/decorator/earning', async (req, res) => {
            const { decoratorEmail, bookingStatus } = req.query;

            const query = {}

            if (decoratorEmail) {
                query.decoratorEmail = decoratorEmail
            }
            if (bookingStatus) {
                query.bookingStatus = bookingStatus

            }

            else {
                query.bookingStatus = bookingStatus
            }
            const cursor = bookingCollection.find(query)
            const result = await cursor.toArray();
            res.send(result);

        })
        // 

        app.patch('/bookings/:id/reject', async (req, res) => {


            const { decoratorId } = req.body;

            // parcel update
            const id = req.params.id;
            const bookingQuery = { _id: new ObjectId(id) };

            const updatedBooking = {
                $set: {
                    bookingStatus: 'panding_assign'
                },
                $unset: {
                    decoratorId: "",
                    decoratorName: "",
                    decoratorEmail: ""
                }
            };

            const bookingResult = await bookingCollection.updateOne(bookingQuery, updatedBooking);

            // decorator update
            const decoratorQuery = { _id: new ObjectId(decoratorId) };

            const decoratorUpdatedDoc = {
                $set: {
                    workStatus: 'available'
                }
            };

            const decoratorResult = await decoratorCollection.updateOne(decoratorQuery, decoratorUpdatedDoc);

            res.send({ bookingResult, decoratorResult });
        });


        // 

        app.delete('/bookings/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await bookingCollection.deleteOne(query);
            res.send(result)
        })


        app.patch('/bookings/:id', async (req, res) => {
            const { decoratorId, decoratorEmail, decoratorName, trackingId } = req.body;

            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const updatedDoc = {
                $set: {
                    bookingStatus: 'decorator_assigned',
                    decoratorId: decoratorId,
                    decoratorName: decoratorName,
                    decoratorEmail: decoratorEmail

                }
            }
            const result = await bookingCollection.updateOne(query, updatedDoc)

            const decoratorQuery = { _id: new ObjectId(decoratorId) }
            const decoratorUpdatedDoc = {
                $set: {
                    workStatus: 'Task_assigned'
                }
            }
            const decoratorResult = await decoratorCollection.updateOne(decoratorQuery, decoratorUpdatedDoc);
            logTracking(trackingId, 'decorator_assigned')

            res.send(decoratorResult)
        })


        //multiple same link thakle specific kore dite hbe

        app.patch('/bookings/:id/status', async (req, res) => {

            const { bookingStatus, decoratorId, trackingId } = req.body;

            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const updatedDoc = {
                $set: {
                    bookingStatus: bookingStatus
                }
            }

            if (bookingStatus === 'Completed') {
                const decoratorQuery = { _id: new ObjectId(decoratorId) }
                const decoratorUpdatedDoc = {
                    $set: {
                        workStatus: 'available'
                    }
                }
                const decoratorResult = await decoratorCollection.updateOne(decoratorQuery, decoratorUpdatedDoc);

            }
            const result = await bookingCollection.updateOne(query, updatedDoc)
            logTracking(trackingId, bookingStatus)
            res.send(result)


        })


        //user API
        app.post('/users', async (req, res) => {
            const user = req.body
            user.role = 'user'

            const email = user.email
            const userExist = await userCollection.findOne({ email })
            if (userExist) {
                return res.send({ message: 'user exist' })
            }
            user.createdAt = new Date()
            const result = await userCollection.insertOne(user)
            res.send(result)

        })


        app.get('/users', verifyFBToken, async (req, res) => {
            const searchText = req.query.searchText;
            const query = {}
            if (searchText) {

                query.$or = [
                    { displayName: { $regex: searchText, $options: 'i' } },

                    { email: { $regex: searchText, $options: 'i' } },
                ]
            }
            const cursor = userCollection.find(query).sort({ createdAt: -1 }).limit(7)
            const result = await cursor.toArray()
            res.send(result)
        })

        app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            const roleInfo = req.body;

            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const updateDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await userCollection.updateOne(query, updateDoc)
            res.send(result);
        })




        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await userCollection.findOne(query);

            res.send({ role: user?.role || 'user' })

        })
        //my-service
        app.get('/my-services', async (req, res) => {
            const email = req.query.email;
            const result = await serviceCollection.find({ createdBy: email }).toArray();
            res.send(result);
        });
        app.get('/services/:id', async (req, res) => {

            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const result = await serviceCollection.findOne(query);

            res.send(result);
        });

        app.patch('/services/:id', async (req, res) => {

            const id = req.params.id;
            const updatedData = req.body;
            const query = { _id: new ObjectId(id) }


            const result = await serviceCollection.updateOne(
                query,
                {
                    $set: updatedData
                }
            );

            res.send(result);
        });

        // services API
        app.post('/services', async (req, res) => {
            const service = {
                ...req.body,
                createdAt: new Date()

            }

            const result = await serviceCollection.insertOne(service)
            res.send(result)
        })


        app.get('/services', async (req, res) => {
            const result = await serviceCollection.find().limit(3).toArray();
            res.send(result);
        });
        app.get('/allServices', async (req, res) => {
            const searchText = req.query.searchText;
            const query = {};

            if (searchText) {
                query.serviceCategory = { $regex: searchText, $options: 'i' };
            }

            const result = await serviceCollection.find(query).sort({ createdAt: -1 }).toArray();
            res.send(result);
        });


        app.get('/serviceDetails/:id', async (req, res) => {
            const id = req.params.id;

            const query = { _id: new ObjectId(id) };

            const result = await serviceCollection.findOne(query);

            res.send(result);
        });

        app.delete('/services/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await serviceCollection.deleteOne(query);

            res.send(result);
        });



        //payment API
        //payment API
        app.post('/create-checkout-session', async (req, res) => {
            try {
                const paymentInfo = req.body;
                const amount = Math.round(Number(paymentInfo.cost) * 100);

                if (!amount || amount <= 0) {
                    return res.status(400).send({ message: 'Invalid cost' });
                }

                const session = await stripe.checkout.sessions.create({
                    line_items: [
                        {
                            price_data: {
                                currency: 'usd',
                                unit_amount: amount,
                                product_data: {
                                    name: paymentInfo.serviceName
                                },
                            },
                            quantity: 1,
                        },
                    ],
                    customer_email: paymentInfo.userEmail,
                    mode: 'payment',
                    metadata: {
                        bookingId: paymentInfo.bookingId,
                        serviceName: paymentInfo.serviceName,
                        trackingId: paymentInfo.trackingId
                    },
                    success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
                });

                res.send({ url: session.url });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });


        const DECORATOR_RATE = 0.9; // decorator 90%, admin 10%

        app.patch('/payment-success', async (req, res) => {
            try {
                const sessionId = req.query.session_id;
                const session = await stripe.checkout.sessions.retrieve(sessionId);

                if (session.payment_status !== 'paid') {
                    return res.send({ success: false });
                }

                const transactionId = session.payment_intent;
                const trackingId = session.metadata.trackingId;
                const bookingId = session.metadata.bookingId;

                const paymentExist = await paymentCollection.findOne({ transactionId });
                if (paymentExist) {
                    return res.send({
                        success: true,
                        message: 'already exist',
                        transactionId,
                        trackingId: paymentExist.trackingId
                    });
                }

                // split in cents, no float error
                const totalCents = session.amount_total;
                const decoratorCents = Math.round(totalCents * DECORATOR_RATE);
                const adminCents = totalCents - decoratorCents;

                const total = totalCents / 100;
                const decoratorEarning = decoratorCents / 100;
                const adminEarning = adminCents / 100;

                const payment = {
                    amount: total,
                    decoratorEarning,
                    adminEarning,
                    curency: session.currency,
                    customerEmail: session.customer_email,
                    bookingId,
                    serviceName: session.metadata.serviceName,
                    transactionId,
                    paymentStatus: session.payment_status,
                    paidAt: new Date(),
                    trackingId
                };

                // insert first: unique index on transactionId block duplicate
                let resultPayment;
                try {
                    resultPayment = await paymentCollection.insertOne(payment);
                } catch (err) {
                    if (err.code === 11000) {
                        return res.send({
                            success: true,
                            message: 'already exist',
                            transactionId,
                            trackingId
                        });
                    }
                    throw err;
                }

                const bookingResult = await bookingCollection.updateOne(
                    { _id: new ObjectId(bookingId) },
                    {
                        $set: {
                            paymentStatus: 'paid',
                            trackingId,
                            bookingStatus: 'panding_assign',
                            decoratorEarning,
                            adminEarning
                        }
                    }
                );

                const trackingExist = await trackingsCollection.findOne({
                    trackingId,
                    status: 'booking_paid'
                });
                if (!trackingExist) {
                    await logTracking(trackingId, 'booking_paid');
                }

                res.send({
                    success: true,
                    modifyParcel: bookingResult,
                    paymentInfo: resultPayment,
                    trackingId,
                    transactionId,
                    split: { decorator: decoratorEarning, admin: adminEarning }
                });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });



        app.get('/payments', verifyFBToken, async (req, res) => {
            const email = req.query.email;
            const query = {}
            // console.log("headers: ", req.headers)



            if (email) {
                query.customerEmail = email;

                //check emial 
                if (email !== req.decodedEmail) {
                    return res.status(403).send({ message: 'forbidden access' })
                }
            }
            const cursor = paymentCollection.find(query).sort({ paidAt: -1 })
            const result = await cursor.toArray();
            res.send(result)
        })



        //admin earning
        app.get('/admin/earnings-summary', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const [r] = await paymentCollection.aggregate([
                    {
                        $group: {
                            _id: null,
                            adminEarning: {
                                $sum: {
                                    $ifNull: [
                                        '$adminEarning',
                                        { $ifNull: ['$adminShare', { $multiply: ['$amount', 0.1] }] }
                                    ]
                                }
                            }
                        }
                    }
                ]).toArray();

                res.send({ adminEarning: Number((r?.adminEarning || 0).toFixed(2)) });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });


        //
        app.get('/decorator/stats', verifyFBToken, async (req, res) => {
            try {
                const decoratorEmail = req.decodedEmail;

                const [stats] = await bookingCollection.aggregate([
                    { $match: { decoratorEmail } },
                    {
                        $group: {
                            _id: null,
                            totalAssigned: { $sum: 1 },
                            completed: {
                                $sum: { $cond: [{ $eq: ['$bookingStatus', 'Completed'] }, 1, 0] }
                            },
                            earnings: {
                                $sum: {
                                    $cond: [
                                        { $eq: ['$bookingStatus', 'Completed'] },
                                        {
                                            $ifNull: [
                                                '$decoratorEarning',
                                                {
                                                    $multiply: [
                                                        { $convert: { input: '$cost', to: 'double', onError: 0, onNull: 0 } },
                                                        0.9
                                                    ]
                                                }
                                            ]
                                        },
                                        0
                                    ]
                                }
                            }
                        }
                    }
                ]).toArray();

                res.send({
                    totalAssigned: stats?.totalAssigned || 0,
                    completed: stats?.completed || 0,
                    earnings: stats?.earnings || 0
                });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });




        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('running style server!')
})


app.listen(port, () => {
    console.log(`Serverrr running on port ${port}`);
});


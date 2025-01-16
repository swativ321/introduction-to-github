import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// Cache for IATA code validation (would typically be in a database)
const validIATACodes = new Set(['JFK', 'LAX', 'SFO', 'ORD', 'MIA', 'DFW', 'SEA', 'LAS', 'ATL', 'BOS']);

export const handler = async (event) => {
    try {
        // Add logging to debug
        console.log('Received event:', JSON.stringify(event));
        
        // Get the data either from event.body or event directly
        let requestData;
        if (event.body) {
            requestData = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        } else {
            requestData = event;
        }
            
        console.log('Request data:', requestData);

        const { origin, destination, departDate, returnDate } = requestData;
        
        // Validate required fields
        if (!origin || !destination || !departDate) {
            return createResponse(400, { 
                error: 'Missing required fields: origin, destination, and departDate are required' 
            });
        }

        // Input validation
        if (!validateIATACode(origin) || !validateIATACode(destination)) {
            return createResponse(400, { error: 'Invalid airport code' });
        }
        
        if (!validateDates(departDate, returnDate)) {
            return createResponse(400, { error: 'Invalid dates' });
        }

        // Search for outbound flights
        const outboundFlights = await searchFlights(origin, destination, departDate);
        
        // Search for return flights if requested
        let returnFlights = null;
        if (returnDate) {
            returnFlights = await searchFlights(destination, origin, returnDate);
        }
        
        return createResponse(200, {
            outbound: outboundFlights,
            return: returnFlights
        });
    } catch (error) {
        console.error('Error:', error);
        return createResponse(500, { 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

async function searchFlights(origin, destination, date) {
    const params = {
        TableName: 'Flights',
        IndexName: 'RouteDate-Index',
        KeyConditionExpression: 'routeDate = :routeDate',
        ExpressionAttributeValues: {
            ':routeDate': `${origin}-${destination}-${date}`
        }
    };
    
    try {
        const { Items } = await docClient.send(new QueryCommand(params));
        return applyDynamicPricing(Items || []);
    } catch (error) {
        console.error('DynamoDB Error:', error);
        throw error;
    }
}

function validateIATACode(code) {
    return validIATACodes.has(code.toUpperCase());
}

function validateDates(departDate, returnDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const depart = new Date(departDate);
    if (depart < today) {
        return false;
    }
    
    if (returnDate) {
        const return_date = new Date(returnDate);
        if (return_date < depart) {
            return false;
        }
    }
    
    return true;
}

function applyDynamicPricing(flights) {
    const today = new Date();
    
    return flights.map(flight => {
        const flightDate = new Date(flight.departureTime);
        const daysUntilFlight = Math.ceil((flightDate - today) / (1000 * 60 * 60 * 24));
        
        let priceMultiplier = 1.0;
        
        // Increase price as flight date approaches
        if (daysUntilFlight <= 7) {
            priceMultiplier *= 1.3;
        } else if (daysUntilFlight <= 14) {
            priceMultiplier *= 1.2;
        } else if (daysUntilFlight <= 30) {
            priceMultiplier *= 1.1;
        }
        
        // Increase price as seats fill up
        const occupancyRate = (flight.totalSeats - flight.availableSeats) / flight.totalSeats;
        if (occupancyRate > 0.8) {
            priceMultiplier *= 1.4;
        } else if (occupancyRate > 0.6) {
            priceMultiplier *= 1.2;
        }
        
        return {
            ...flight,
            price: Math.round(flight.basePrice * priceMultiplier * 100) / 100
        };
    });
}

function createResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };
}
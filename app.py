from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from sqlalchemy.dialects.postgresql import JSONB
from geoalchemy2 import Geometry
from datetime import datetime
from sqlalchemy import text, or_
import json
import sys
import psycopg2
from psycopg2 import OperationalError

app = Flask(__name__)
# More permissive CORS for development with proper headers
CORS(app, resources={
    r"/*": {
        "origins": ["http://localhost:3000", "http://127.0.0.1:3000"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    }
})

# Database configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'postgresql://postgres:PASSWORD@localhost:5432/landsurveydb'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# Database Model
class LandSurvey(db.Model):
    __tablename__ = 'land_survey'
    id = db.Column(db.Integer, primary_key=True)
    owner_name = db.Column(db.String, nullable=False)
    survey_date = db.Column(db.Date, nullable=False)
    geometry_type = db.Column(db.String, nullable=False)
    coordinates = db.Column(JSONB, nullable=False)
    srid = db.Column(db.Integer, nullable=False, default=32632)
    geom = db.Column(Geometry('GEOMETRY'))
    notes = db.Column(db.String)

    def to_dict(self):
        return {
            'id': self.id,
            'owner_name': self.owner_name,
            'survey_date': self.survey_date.isoformat(),
            'geometry_type': self.geometry_type,
            'coordinates': self.coordinates,
            'srid': self.srid,
            'notes': self.notes
        }

def geojson_to_wkt(geometry_type, coordinates):
    try:
        if geometry_type == 'Point':
            if not isinstance(coordinates, list) or len(coordinates) != 2:
                raise ValueError("Point requires exactly 2 coordinates")
            lng, lat = coordinates
            return f'POINT({lng} {lat})'
        elif geometry_type == 'LineString':
            if not isinstance(coordinates, list) or len(coordinates) < 2:
                raise ValueError("LineString requires at least 2 points")
            points = ", ".join(f"{lng} {lat}" for lng, lat in coordinates)
            return f'LINESTRING({points})'
        elif geometry_type == 'Polygon':
            if (not isinstance(coordinates, list) or 
                len(coordinates) == 0 or 
                not isinstance(coordinates[0], list) or 
                len(coordinates[0]) < 3):
                raise ValueError("Polygon requires at least 3 points in a ring")
            
            ring = coordinates[0]
            # Close the polygon ring if not already closed
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            points = ", ".join(f"{lng} {lat}" for lng, lat in ring)
            return f'POLYGON(({points}))'
        else:
            raise ValueError("Unsupported geometry type")
    except Exception as e:
        app.logger.error(f"Error converting to WKT: {str(e)}")
        raise

def test_database_connection():
    try:
        conn = psycopg2.connect(
            dbname="landsurveydb",
            user="postgres",
            password="c1h1u1k1s1",
            host="localhost",
            port="5432"
        )
        conn.close()
        return True
    except OperationalError as e:
        app.logger.error(f"Database connection failed: {e}")
        return False

@app.route('/health')
def health_check():
    db_ok = test_database_connection()
    return jsonify({
        "status": "running",
        "database": "connected" if db_ok else "disconnected"
    }), 200 if db_ok else 503

@app.route('/records', methods=['POST'])
def add_record():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        required = ['owner_name', 'survey_date', 'geometry_type', 'coordinates', 'srid']
        if not all(field in data for field in required):
            return jsonify({"error": "Missing required fields"}), 400

        try:
            survey_date = datetime.strptime(data['survey_date'], '%Y-%m-%d').date()
        except ValueError:
            return jsonify({"error": "Invalid survey_date format, expected YYYY-MM-DD"}), 400

        try:
            srid = int(data['srid'])
        except ValueError:
            return jsonify({"error": "SRID must be an integer"}), 400

        wkt = geojson_to_wkt(data['geometry_type'], data['coordinates'])
        
        new_record = LandSurvey(
            owner_name=data['owner_name'],
            survey_date=survey_date,
            geometry_type=data['geometry_type'],
            coordinates=data['coordinates'],
            srid=srid,
            geom=f'SRID={srid};{wkt}',
            notes=data.get('notes')
        )

        db.session.add(new_record)
        db.session.commit()

        # Get GeoJSON representation
        sql = text("SELECT ST_AsGeoJSON(ST_Transform(geom, 4326)) FROM land_survey WHERE id = :id")
        geojson_str = db.session.execute(sql, {'id': new_record.id}).scalar()
        geom_geojson = json.loads(geojson_str) if geojson_str else None

        response_data = new_record.to_dict()
        response_data['geometry_geojson'] = geom_geojson

        return jsonify({
            "message": "Record added successfully",
            "record": response_data
        }), 201

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Error adding record: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/records', methods=['GET'])
def list_records():
    try:
        owner_name = request.args.get('owner_name')
        query = LandSurvey.query
        
        if owner_name:
            query = query.filter(LandSurvey.owner_name.ilike(f'%{owner_name}%'))
        
        records = query.order_by(LandSurvey.survey_date.desc()).all()
        results = []

        for rec in records:
            sql = text("SELECT ST_AsGeoJSON(ST_Transform(geom, 4326)) FROM land_survey WHERE id = :id")
            geojson_str = db.session.execute(sql, {'id': rec.id}).scalar()
            geom_geojson = json.loads(geojson_str) if geojson_str else None

            record_data = rec.to_dict()
            record_data['geometry_geojson'] = geom_geojson
            results.append(record_data)

        return jsonify(results)

    except Exception as e:
        app.logger.error(f"Error listing records: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/records/<int:record_id>', methods=['GET'])
def get_record(record_id):
    try:
        record = LandSurvey.query.get(record_id)
        if not record:
            return jsonify({"error": "Record not found"}), 404

        sql = text("SELECT ST_AsGeoJSON(ST_Transform(geom, 4326)) FROM land_survey WHERE id = :id")
        geojson_str = db.session.execute(sql, {'id': record.id}).scalar()
        geom_geojson = json.loads(geojson_str) if geojson_str else None

        response_data = record.to_dict()
        response_data['geometry_geojson'] = geom_geojson

        return jsonify(response_data)

    except Exception as e:
        app.logger.error(f"Error getting record {record_id}: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    try:
        # Verify database connection before starting
        if not test_database_connection():
            print("❌ Failed to connect to database. Check your PostgreSQL service and credentials.")
            sys.exit(1)
        
        with app.app_context():
            db.create_all()  # Create tables if they don't exist
        
        print("✅ Database connection successful")
        print("🚀 Starting Flask server on http://localhost:5000")
        app.run(host='0.0.0.0', port=5000, debug=True)
    except Exception as e:
        print(f"❌ Failed to start server: {str(e)}", file=sys.stderr)
        sys.exit(1)
